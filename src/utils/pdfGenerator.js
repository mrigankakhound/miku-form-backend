'use strict';

const PDFDocument = require('pdfkit');
const axios       = require('axios');
const fs          = require('fs');
const path        = require('path');

// ── Logos loaded ONCE at startup ──────────────────────────────────
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
let PM_LOGO  = null;
let DRT_LOGO = null;
try {
  PM_LOGO  = fs.readFileSync(path.join(ASSETS_DIR, 'pm.png'));
  DRT_LOGO = fs.readFileSync(path.join(ASSETS_DIR, 'DRTlogo.png'));
  console.log(`[logos] loaded — pm:${PM_LOGO.length}b drt:${DRT_LOGO.length}b`);
} catch (e) {
  console.error('[logos] load error:', e.message);
}

// A4 constants
const A4_W     = 595.28;
const A4_H     = 841.89;
const MARGIN   = 40;
const CW       = A4_W - MARGIN * 2;
const FOOTER_Y = A4_H - 52;

// ── Cloudinary URL resize ─────────────────────────────────────────
// Reduces each photo from 2-5 MB to ~150-250 KB before downloading.
// This is the PRIMARY memory fix for Render free tier OOM.
function cdnSmall(url) {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  return url.replace('/upload/', '/upload/w_600,q_75,c_limit,f_jpg/');
}

// ── Download image Buffer ─────────────────────────────────────────
async function dlImg(url) {
  const r = await axios.get(cdnSmall(url), { responseType: 'arraybuffer', timeout: 20000 });
  return Buffer.from(r.data);
}

// ── Date formatter ────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return String.fromCharCode(0x2014);
  const dt = new Date(d);
  return String(dt.getDate()).padStart(2,'0') + '/' +
         String(dt.getMonth()+1).padStart(2,'0') + '/' +
         dt.getFullYear();
}

// ── Header: [PM Logo] DRT ENTERPRISE [DRT Logo] ───────────────────
function drawHeader(doc) {
  const H = 82;

  // Dark navy background
  doc.rect(0, 0, A4_W, H).fill('#0d1b3e');
  // Gold accent line
  doc.moveTo(0, H).lineTo(A4_W, H).lineWidth(2.5).strokeColor('#f4c430').stroke();

  // Clip logos strictly to header band so image text doesn't overflow
  doc.save();
  doc.rect(0, 0, A4_W, H).clip();
  if (PM_LOGO)  { try { doc.image(PM_LOGO,  MARGIN, 8,                   { fit: [88, 66],   align: 'center', valign: 'center' }); } catch(_){} }
  if (DRT_LOGO) { try { doc.image(DRT_LOGO, A4_W - MARGIN - 123, 2,      { fit: [108, 78],  align: 'center', valign: 'center' }); } catch(_){} }
  doc.restore();

  // Centred title text (drawn on top of logos)
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff');
  doc.text('DRT ENTERPRISE', 0, 18, { align: 'center', width: A4_W });
  doc.font('Helvetica').fontSize(8.5).fillColor('#ffffff');  // white, not blue
  doc.text('Solar System Installation Record', 0, 43, { align: 'center', width: A4_W });

  return H + 10;
}

// ── Footer ────────────────────────────────────────────────────────
function drawFooter(doc) {
  // Double separator line
  doc.moveTo(MARGIN, FOOTER_Y).lineTo(A4_W - MARGIN, FOOTER_Y)
     .lineWidth(1).strokeColor('#222').stroke();
  doc.moveTo(MARGIN, FOOTER_Y + 3).lineTo(A4_W - MARGIN, FOOTER_Y + 3)
     .lineWidth(0.3).strokeColor('#999').stroke();

  const R1 = FOOTER_Y + 11;
  const R2 = FOOTER_Y + 24;
  const LW = CW / 2 - 10;  // left column width
  const RX = MARGIN + CW / 2 + 10; // right column x
  const RW = CW / 2 - 10;  // right column width

  doc.font('Helvetica').fontSize(7.5).fillColor('#222');

  // Left column
  doc.text('GSTIN: 18ABXFM0804A1ZE',                  MARGIN, R1, { width: LW, lineBreak: false });
  doc.text('Contact: +91 7002322258 | +91 8254028956', MARGIN, R2, { width: LW, lineBreak: false });

  // Right column (right-aligned)
  doc.text('Email: contact@drtweb.in',                                  RX, R1, { width: RW, align: 'right', lineBreak: false });
  doc.text('Web: www.drtweb.in | Pulibor, Jorhat - 785006, Assam',      RX, R2, { width: RW, align: 'right', lineBreak: false });
}

// ── Field row ─────────────────────────────────────────────────────
function drawField(doc, label, value, x, y, w) {
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#333').text(label, x, y, { width: 100, lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor('#111').text(String(value || String.fromCharCode(0x2014)), x + 100, y, { width: w - 100, lineBreak: false });
  return y + 16;
}

// ── Photo box ─────────────────────────────────────────────────────
function drawPhoto(doc, buf, label, bx, by, bw, bh) {
  if (bh < 30) return;
  doc.rect(bx, by, bw, 18).fill('#0d1b3e');
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff').text(label, bx + 6, by + 5, { width: bw - 12, lineBreak: false });
  const py = by + 18, ph = bh - 18;
  doc.rect(bx, py, bw, ph).lineWidth(0.5).strokeColor('#bbb').stroke();
  if (buf) {
    try { doc.image(buf, bx, py, { fit: [bw, ph], align: 'center', valign: 'center' }); }
    catch(e) { doc.font('Helvetica').fontSize(8).fillColor('#aaa').text('Image unavailable', bx, py + ph/2 - 6, { width: bw, align: 'center' }); }
  }
}

// ── Main export ───────────────────────────────────────────────────
async function generatePDF(record) {
  const m0 = process.memoryUsage();
  console.log(`[gPDF:1] start rss:${Math.round(m0.rss/1048576)}MB heap:${Math.round(m0.heapUsed/1048576)}MB`);

  console.log('[gPDF:2] downloading images with Cloudinary resize (w_900,q_80)...');
  const [img1, img2, img3, img4, img5] = await Promise.all([
    dlImg(record.photo1.url).catch(e => { console.error('[gPDF] photo1 FAIL:', e.message); return null; }),
    dlImg(record.photo2.url).catch(e => { console.error('[gPDF] photo2 FAIL:', e.message); return null; }),
    dlImg(record.photo3.url).catch(e => { console.error('[gPDF] photo3 FAIL:', e.message); return null; }),
    dlImg(record.photo4.url).catch(e => { console.error('[gPDF] photo4 FAIL:', e.message); return null; }),
    record.photo5 ? dlImg(record.photo5.url).catch(e => { console.error('[gPDF] photo5 FAIL:', e.message); return null; }) : Promise.resolve(null),
  ]);
  console.log('[gPDF:3] sizes: ' + [img1,img2,img3,img4,img5].map((b,i)=>`p${i+1}:${b?Math.round(b.length/1024)+'KB':'FAIL'}`).join(' '));

  console.log('[gPDF:4] creating PDFDocument...');
  const doc = new PDFDocument({ size: 'A4', margin: 0, compress: false,
    info: { Title: `DRT Enterprise - ${record.consumerName}`, Author: 'DRT Enterprise' } });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((res, rej) => { doc.on('end', res); doc.on('error', e => rej(new Error('PDFKit: '+e.message))); });

  // PAGE 1 — Consumer Info + Inverter Photo
  let y = drawHeader(doc);
  const CARD_H = 196;
  doc.rect(MARGIN, y, CW, CARD_H).lineWidth(0.5).strokeColor('#ddd').stroke();
  doc.rect(MARGIN, y, CW, 22).fill('#eef2ff');
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0d1b3e').text('CONSUMER INFORMATION', MARGIN + 8, y + 7);
  doc.moveTo(MARGIN, y+22).lineTo(MARGIN+CW, y+22).lineWidth(0.3).strokeColor('#ddd').stroke();
  const C1 = MARGIN+8, C2 = MARGIN+CW/2+4, CFW = CW/2-16;
  let y1 = y+30, y2 = y+30;
  y1 = drawField(doc,'Consumer Name:',   record.consumerName,             C1,y1,CFW);
  y1 = drawField(doc,'Consumer No:',     record.consumerNo,               C1,y1,CFW);
  y1 = drawField(doc,'Contact Number:',  record.contactNumber,            C1,y1,CFW);
  y1 = drawField(doc,'Application Ref:', record.applicationReferenceNo,   C1,y1,CFW);
  y1 = drawField(doc,'Address:',         record.address,                  C1,y1,CFW);
  y1 = drawField(doc,'Sub-Division:',    record.subDivision,              C1,y1,CFW);
  y2 = drawField(doc,'Plant Capacity:',   record.plantCapacity,                       C2,y2,CFW);
  y2 = drawField(doc,'Installation Date:',fmtDate(record.installationDate),           C2,y2,CFW);
  y2 = drawField(doc,'Commissioning:',    fmtDate(record.systemCommissioningDate),    C2,y2,CFW);
  y2 = drawField(doc,'Vendor Name:',      record.vendorName,                          C2,y2,CFW);
  y += CARD_H + 10;
  drawPhoto(doc, img1, 'INVERTER PHOTO', MARGIN, y, CW, FOOTER_Y - 15 - y);
  drawFooter(doc);

  // PAGE 2 — Panel Photo + Earth Photo
  doc.addPage({ size: 'A4', margin: 0 });
  y = drawHeader(doc);
  const h2 = Math.floor((FOOTER_Y - 15 - y - 10) / 2);
  drawPhoto(doc, img2, 'PANEL PHOTO', MARGIN, y,       CW, h2);
  drawPhoto(doc, img3, 'EARTH PHOTO', MARGIN, y+h2+10, CW, h2);
  drawFooter(doc);

  // PAGE 3 — LA Photo + optional 5th Photo
  doc.addPage({ size: 'A4', margin: 0 });
  y = drawHeader(doc);
  if (img5) {
    const h3 = Math.floor((FOOTER_Y - 15 - y - 10) / 2);
    drawPhoto(doc, img4, 'LA PHOTO',     MARGIN, y,      CW, h3);
    drawPhoto(doc, img5, 'PHOTOGRAPH 5', MARGIN, y+h3+10, CW, h3);
  } else {
    drawPhoto(doc, img4, 'LA PHOTO', MARGIN, y, CW, FOOTER_Y - 15 - y);
  }
  drawFooter(doc);

  console.log('[gPDF:5] finalizing...');
  doc.end();
  await done;
  const buf = Buffer.concat(chunks);
  const m1 = process.memoryUsage();
  console.log(`[gPDF:6] done size:${Math.round(buf.length/1024)}KB rss:${Math.round(m1.rss/1048576)}MB`);
  return buf;
}

module.exports = { generatePDF };
