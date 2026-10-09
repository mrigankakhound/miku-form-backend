const PDFDocument = require('pdfkit');
const axios = require('axios');
const fs   = require('fs');
const path = require('path');

// A4 dimensions in points
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

// Footer height reservation
const FOOTER_HEIGHT = 55;
const FOOTER_LINE_Y = A4_HEIGHT - FOOTER_HEIGHT - 5;

/**
 * Download image buffer from URL
 */
async function downloadImage(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  return Buffer.from(response.data);
}

/**
 * Format a date to DD/MM/YYYY
 */
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Draw professional footer on the current page.
 * Two-column layout:
 *   Left  — GSTIN | Contact  (bold values)
 *   Right — Email | Web      (bold values, right-aligned)
 */
function drawFooter(doc) {
  // thick + thin double-rule separator
  doc
    .moveTo(MARGIN, FOOTER_LINE_Y)
    .lineTo(A4_WIDTH - MARGIN, FOOTER_LINE_Y)
    .lineWidth(1)
    .strokeColor('#1a1a1a')
    .stroke();
  doc
    .moveTo(MARGIN, FOOTER_LINE_Y + 2.5)
    .lineTo(A4_WIDTH - MARGIN, FOOTER_LINE_Y + 2.5)
    .lineWidth(0.3)
    .strokeColor('#666666')
    .stroke();

  const fy = FOOTER_LINE_Y + 12; // first row y

  // ── LEFT column ──
  const leftX = MARGIN;

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#444444');
  doc.text('GSTIN:', leftX, fy, { continued: true, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#111111');
  doc.text('  18ABXFM0804A1ZE', { lineBreak: false });

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#444444');
  doc.text('Contact:', leftX, fy + 12, { continued: true, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#111111');
  doc.text('  +91 7002322258  |  +91 8254028956', { lineBreak: false });

  // ── RIGHT column — right-aligned, bold values ──
  const rightEdge = A4_WIDTH - MARGIN;
  const emailText = 'Email:  contact@drtweb.in';
  const webText   = 'Web:  www.drtweb.in';

  const emailW = doc.font('Helvetica-Bold').widthOfString(emailText);
  const webW   = doc.font('Helvetica-Bold').widthOfString(webText);

  // Email row
  const emailX = rightEdge - emailW;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#444444');
  doc.text('Email:', emailX, fy, { continued: true, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#111111');
  doc.text('  contact@drtweb.in', { lineBreak: false });

  // Web row
  const webX = rightEdge - webW;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#444444');
  doc.text('Web:', webX, fy + 12, { continued: true, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#111111');
  doc.text('  www.drtweb.in', { lineBreak: false });
}

/**
 * Draw an image inside an allocated area with contain-fit centering.
 */
function drawContainedImage(doc, imgBuffer, boxX, boxY, boxWidth, boxHeight) {
  try {
    doc.image(imgBuffer, boxX, boxY, {
      fit: [boxWidth, boxHeight],
      align: 'center',
      valign: 'center',
    });
  } catch (err) {
    console.error('Error drawing image in PDF:', err.message);
    doc.rect(boxX, boxY, boxWidth, boxHeight).stroke();
    doc.fontSize(9).text('Image unavailable', boxX, boxY + boxHeight / 2 - 5, {
      width: boxWidth,
      align: 'center',
    });
  }
}

/**
 * Draw a photo section heading with a filled grey band
 */
function drawPhotoHeading(doc, label, y) {
  const bandH = 16;
  doc.rect(MARGIN, y, CONTENT_WIDTH, bandH).fill('#f0f0f0');
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1a1a1a');
  doc.text(label, MARGIN + 6, y + 3, { width: CONTENT_WIDTH - 6 });
  return y + bandH + 4;
}

/**
 * Draw a dashed divider line
 */
function drawDashedLine(doc, y) {
  doc
    .moveTo(MARGIN, y)
    .lineTo(A4_WIDTH - MARGIN, y)
    .lineWidth(0.3)
    .dash(3, { space: 3 })
    .stroke();
  doc.undash();
}

/**
 * Generate a 3-page A4 PDF for a solar record.
 *
 * Page 1 – Consumer information + Inverter Photo (photo1)
 * Page 2 – Panel Photo (photo2, upper) + Earth Photo (photo3, lower)
 * Page 3 – LA Photo (photo4, upper) + 5th Photo (photo5, lower, if present)
 *
 * @param {object} record - Mongoose document
 * @returns {PDFDocument} - PDFKit document (pipe to response)
 */
async function generatePDF(record) {
  // Download required record images in parallel
  const imageDownloads = [
    downloadImage(record.photo1.url),
    downloadImage(record.photo2.url),
    downloadImage(record.photo3.url),
    downloadImage(record.photo4.url),
  ];
  if (record.photo5) {
    imageDownloads.push(downloadImage(record.photo5.url));
  }

  const [img1, img2, img3, img4, img5] = await Promise.all(imageDownloads);

  // Load logos — prefer reading from disk (works locally without internet).
  // Falls back to the live production URL with a short timeout.
  // Each logo is loaded independently so one failure never blocks the other.
  const LOGO_DIR      = path.resolve(__dirname, '../../../frontend/public');
  const FRONTEND_BASE = 'https://drtweb.in/form';

  async function loadLogo(filename) {
    const localPath = path.join(LOGO_DIR, filename);
    if (fs.existsSync(localPath)) {
      return fs.readFileSync(localPath);
    }
    // fallback: fetch from production URL with a tight 5s timeout
    const response = await axios.get(`${FRONTEND_BASE}/${filename}`, {
      responseType: 'arraybuffer',
      timeout: 5000,
    });
    return Buffer.from(response.data);
  }

  const [pmLogoBuffer, drtLogoBuffer] = await Promise.all([
    loadLogo('pm.png').catch((e) => {
      console.error('PM logo load failed:', e.message);
      return null;
    }),
    loadLogo('DRTlogo.png').catch((e) => {
      console.error('DRT logo load failed:', e.message);
      return null;
    }),
  ]);

  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: {
      Title: `DRT Enterprise - ${record.consumerName}`,
      Author: 'DRT Enterprise',
    },
  });

  // ─────────────────────────────────────────────
  // PAGE 1 — Consumer Information + Inverter Photo
  // ─────────────────────────────────────────────
  let y = MARGIN;

  // ══════════════════════════════════════════════
  // PROFESSIONAL HEADER
  // Layout: [PM Logo]   DRT ENTERPRISE   [DRT Logo]
  // ══════════════════════════════════════════════

  // ── Dimensions ──────────────────────────────
  const LOGO_BOX_W  = 88;   // PM logo bounding-box width/height
  const LOGO_BOX_H  = 60;
  const DRT_LOGO_W  = 108;  // DRT logo — slightly larger
  const DRT_LOGO_H  = 74;

  const leftLogoX  = MARGIN;
  const rightLogoX = A4_WIDTH - MARGIN - LOGO_BOX_W;
  const centreX    = MARGIN + LOGO_BOX_W + 8;
  const centreW    = A4_WIDTH - MARGIN * 2 - LOGO_BOX_W * 2 - 16;

  // ── PM logo — left ──────────────────────────
  if (pmLogoBuffer) {
    try {
      doc.image(pmLogoBuffer, leftLogoX, y, {
        fit:    [LOGO_BOX_W, LOGO_BOX_H],
        align:  'left',
        valign: 'center',
      });
    } catch (e) {
      console.error('PM logo error:', e.message);
    }
  }

  // ── DRT logo — right (larger, shifted left by 15pt) ─
  if (drtLogoBuffer) {
    try {
      doc.image(drtLogoBuffer, rightLogoX - 15, y, {
        fit:    [DRT_LOGO_W, DRT_LOGO_H],
        align:  'right',
        valign: 'center',
      });
    } catch (e) {
      console.error('DRT logo error:', e.message);
    }
  }

  // ── Company name — centred between logos ────
  const nameY = y + LOGO_BOX_H / 2 - 12;
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#1a1a1a');
  doc.text('DRT ENTERPRISE', centreX, nameY, {
    width:     centreW,
    align:     'center',
    lineBreak: false,
  });

  // Tagline
  doc.font('Helvetica').fontSize(7.5).fillColor('#666666');
  doc.text('Solar Energy Solutions', centreX, nameY + 20, {
    width:     centreW,
    align:     'center',
    lineBreak: false,
  });

  // Subtle horizontal rule below tagline (inside logo strip)
  const accentLineY = nameY + 32;
  doc
    .moveTo(centreX + centreW * 0.08, accentLineY)
    .lineTo(centreX + centreW * 0.92, accentLineY)
    .lineWidth(0.4)
    .strokeColor('#bbbbbb')
    .stroke();

  // ── Double-rule separator under header ───────
  const separatorY = y + LOGO_BOX_H + 5;
  doc
    .moveTo(MARGIN, separatorY)
    .lineTo(A4_WIDTH - MARGIN, separatorY)
    .lineWidth(1.2)
    .strokeColor('#2c3e50')
    .stroke();
  doc
    .moveTo(MARGIN, separatorY + 2.5)
    .lineTo(A4_WIDTH - MARGIN, separatorY + 2.5)
    .lineWidth(0.3)
    .strokeColor('#7f8c8d')
    .stroke();

  y = separatorY + 10;

  // ── CONSUMER INFORMATION — grey band heading ──
  const sectionBandH = 18;
  doc.rect(MARGIN, y, CONTENT_WIDTH, sectionBandH).fill('#f0f0f0');
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a');
  doc.text('CONSUMER INFORMATION', MARGIN, y + 4, { width: CONTENT_WIDTH, align: 'center' });
  y += sectionBandH + 4;

  // ── INFO TABLE ──
  const labelCol  = MARGIN;
  const colonCol  = MARGIN + 175;
  const valueCol  = colonCol + 12;
  const valueWidth = A4_WIDTH - MARGIN - valueCol;

  const fields = [
    ['Consumer Name',               record.consumerName],
    ['Consumer No',                  record.consumerNo],
    ['Contact Number',               record.contactNumber],
    ['Application Reference No',     record.applicationReferenceNo],
    ['Address',                      record.address],
    ['Plant Capacity',               record.plantCapacity],
    ['Installation Date',            formatDate(record.installationDate)],
    ['Sub-Division',                 record.subDivision],
    ['Date of System Commissioning', formatDate(record.systemCommissioningDate)],
    ['Vendor Name',                  record.vendorName],
  ];

  doc.fontSize(10);

  for (let i = 0; i < fields.length; i++) {
    const [label, value] = fields[i];
    const valueHeight = doc.heightOfString(String(value || ''), {
      width: valueWidth,
      lineGap: 2,
    });
    const rowHeight = Math.max(16, valueHeight + 4);

    // Alternating row background
    if (i % 2 === 0) {
      doc.rect(MARGIN, y - 1, CONTENT_WIDTH, rowHeight + 2).fill('#fafafa');
    }

    doc.font('Helvetica-Bold').fillColor('#222222');
    doc.text(label, labelCol, y, { width: 170, lineBreak: false });

    doc.font('Helvetica').fillColor('#555555');
    doc.text(':', colonCol, y, { lineBreak: false });

    doc.font('Helvetica').fillColor('#1a1a1a');
    doc.text(String(value || ''), valueCol, y, { width: valueWidth, lineGap: 2 });

    y += rowHeight + 2;
  }

  y += 6;

  // Separator before photo section
  doc.moveTo(MARGIN, y).lineTo(A4_WIDTH - MARGIN, y).lineWidth(0.5).strokeColor('#cccccc').stroke();
  y += 8;

  // ── INVERTER PHOTO ──
  y = drawPhotoHeading(doc, 'Inverter Photo', y);

  const photo1BoxY      = y;
  const photo1BoxHeight = FOOTER_LINE_Y - 10 - photo1BoxY;

  if (photo1BoxHeight > 30) {
    drawContainedImage(doc, img1, MARGIN, photo1BoxY, CONTENT_WIDTH, photo1BoxHeight);
  }

  drawFooter(doc);

  // ─────────────────────────────────────────────
  // PAGE 2 — Panel Photo (upper) + Earth Photo (lower)
  // ─────────────────────────────────────────────
  doc.addPage({ size: 'A4', margin: 0 });

  const page2Top         = MARGIN;
  const totalPage2Height = FOOTER_LINE_Y - 10 - page2Top;
  const labelHeight      = 18;
  const gapBetween       = 10;
  const upperHalfHeight  = Math.floor((totalPage2Height - gapBetween - labelHeight) / 2);

  let p2y = page2Top;
  p2y = drawPhotoHeading(doc, 'Panel Photo', p2y);
  const panelBoxHeight = upperHalfHeight - labelHeight;
  drawContainedImage(doc, img2, MARGIN, p2y, CONTENT_WIDTH, panelBoxHeight);
  p2y += panelBoxHeight + gapBetween / 2;

  drawDashedLine(doc, p2y);
  p2y += gapBetween / 2;

  p2y = drawPhotoHeading(doc, 'Earth Photo', p2y);
  const earthBoxHeight = FOOTER_LINE_Y - 10 - p2y;
  if (earthBoxHeight > 30) {
    drawContainedImage(doc, img3, MARGIN, p2y, CONTENT_WIDTH, earthBoxHeight);
  }

  drawFooter(doc);

  // ─────────────────────────────────────────────
  // PAGE 3 — LA Photo (upper) + 5th Photo (lower, optional)
  // ─────────────────────────────────────────────
  doc.addPage({ size: 'A4', margin: 0 });

  let p3y = MARGIN;

  if (img5) {
    const totalPage3Height = FOOTER_LINE_Y - 10 - p3y;
    const upperHeight      = Math.floor((totalPage3Height - gapBetween - labelHeight) / 2);

    p3y = drawPhotoHeading(doc, 'LA Photo', p3y);
    const laBoxHeight = upperHeight - labelHeight;
    drawContainedImage(doc, img4, MARGIN, p3y, CONTENT_WIDTH, laBoxHeight);
    p3y += laBoxHeight + gapBetween / 2;

    drawDashedLine(doc, p3y);
    p3y += gapBetween / 2;

    p3y = drawPhotoHeading(doc, 'Photograph 5', p3y);
    const photo5BoxHeight = FOOTER_LINE_Y - 10 - p3y;
    if (photo5BoxHeight > 30) {
      drawContainedImage(doc, img5, MARGIN, p3y, CONTENT_WIDTH, photo5BoxHeight);
    }
  } else {
    p3y = drawPhotoHeading(doc, 'LA Photo', p3y);
    const laBoxHeight = FOOTER_LINE_Y - 10 - p3y;
    if (laBoxHeight > 30) {
      drawContainedImage(doc, img4, MARGIN, p3y, CONTENT_WIDTH, laBoxHeight);
    }
  }

  drawFooter(doc);

  doc.end();
  return doc;
}

module.exports = { generatePDF };
