const PDFDocument = require('pdfkit');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

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
 *   Left  — GSTIN | Contact
 *   Right — Email | Web  (right-aligned)
 */
function drawFooter(doc) {
  // ── thick + thin double-rule separator ──
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

  // Vertical centre: 2 rows × 11pt gap => total text height ≈ 19pt
  // Available space: FOOTER_LINE_Y + 5 (after thin rule) to page bottom
  const fy = FOOTER_LINE_Y + 12;  // first row y

  // ── LEFT column ──
  const leftX = MARGIN;

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#444444');
  doc.text('GSTIN:', leftX, fy, { continued: true, lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor('#111111');
  doc.text('  18ABXFM0804A1ZE', { lineBreak: false });

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#444444');
  doc.text('Contact:', leftX, fy + 12, { continued: true, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#111111');
  doc.text('  +91 7002322258  |  +91 8254028956', { lineBreak: false });

  // ── RIGHT column — right-aligned ──
  // Measure each line and place so text ends at right margin
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
 * imgBuffer: Buffer of the image
 * We use PDFKit's image method with width/height constraints.
 */
function drawContainedImage(doc, imgBuffer, boxX, boxY, boxWidth, boxHeight) {
  try {
    // Let PDFKit handle image reading; use fit option to preserve aspect ratio
    doc.image(imgBuffer, boxX, boxY, {
      fit: [boxWidth, boxHeight],
      align: 'center',
      valign: 'center',
    });
  } catch (err) {
    console.error('Error drawing image in PDF:', err.message);
    // Draw placeholder box on error
    doc.rect(boxX, boxY, boxWidth, boxHeight).stroke();
    doc.fontSize(9).text('Image unavailable', boxX, boxY + boxHeight / 2 - 5, {
      width: boxWidth,
      align: 'center',
    });
  }
}

/**
 * Draw a photo section heading with a filled-band background
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
 * Generate a 3-page A4 B&W PDF for a solar record.
 *
 * Page 1 – Consumer information + Inverter Photo (photo1)
 * Page 2 – Panel Photo (photo2, upper) + Earth Photo (photo3, lower)
 * Page 3 – LA Photo (photo4, upper) + 5th Photo (photo5, lower, if present)
 *
 * @param {object} record - Mongoose document
 * @returns {PDFDocument} - PDFKit document (pipe to response)
 */
async function generatePDF(record) {
  // Download required images in parallel
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

  // Load logo buffers from local filesystem
  const assetsDir = path.join(
    __dirname,
    '..', '..', '..', 'frontend', 'dist', 'assets'
  );
  const pmLogoBuffer = fs.readFileSync(path.join(assetsDir, 'pm logo.png'));
  const drtLogoBuffer = fs.readFileSync(path.join(assetsDir, 'DRTlogo.png'));

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

  // ─────────────────────────────────────────────
  // PROFESSIONAL HEADER
  // Layout:
  //  [PM Logo]   [Company Details (centre)]   [DRT Logo]
  // ─────────────────────────────────────────────
  const LOGO_BOX_W   = 90;   // reserved width for each logo column
  const LOGO_BOX_H   = 62;   // max height for logos
  const HEADER_H     = LOGO_BOX_H + 2; // total header block height

  const leftLogoX  = MARGIN;
  const rightLogoX = A4_WIDTH - MARGIN - LOGO_BOX_W;
  const centreX    = MARGIN + LOGO_BOX_W + 6;
  const centreW    = A4_WIDTH - MARGIN * 2 - LOGO_BOX_W * 2 - 12;

  // Draw PM logo — left, contained
  try {
    doc.image(pmLogoBuffer, leftLogoX, y, {
      fit: [LOGO_BOX_W, LOGO_BOX_H],
      align: 'left',
      valign: 'center',
    });
  } catch (e) {
    console.error('PM logo error:', e.message);
  }

  // Draw DRT logo — right, contained (larger fit)
  try {
    doc.image(drtLogoBuffer, rightLogoX - 25, y, {
      fit: [115, 78],
      align: 'right',
      valign: 'center',
    });
  } catch (e) {
    console.error('DRT logo error:', e.message);
  }

  // ── Company name — centred between logos ──
  // Vertically centre within logo box
  const nameY = y + (LOGO_BOX_H / 2) - 10;
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#1a1a1a');
  doc.text('DRT ENTERPRISE', centreX, nameY, { width: centreW, align: 'center', lineBreak: false });

  // Subtitle / tagline
  doc.font('Helvetica').fontSize(8).fillColor('#555555');
  doc.text('Solar Energy Solutions', centreX, nameY + 19, { width: centreW, align: 'center', lineBreak: false });

  // Thin accent line below subtitle
  const accentLineY = nameY + 31;
  doc
    .moveTo(centreX + centreW * 0.1, accentLineY)
    .lineTo(centreX + centreW * 0.9, accentLineY)
    .lineWidth(0.5)
    .strokeColor('#aaaaaa')
    .stroke();

  y = MARGIN + HEADER_H + 4;

  // ── Double rule under header (mirrors footer) ──
  doc.moveTo(MARGIN, y).lineTo(A4_WIDTH - MARGIN, y).lineWidth(1).strokeColor('#1a1a1a').stroke();
  y += 3;
  doc.moveTo(MARGIN, y).lineTo(A4_WIDTH - MARGIN, y).lineWidth(0.3).strokeColor('#555555').stroke();
  y += 10;

  // --- CONSUMER INFORMATION TITLE (filled band) ---
  const sectionBandH = 18;
  doc.rect(MARGIN, y, CONTENT_WIDTH, sectionBandH).fill('#f0f0f0');
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a');
  doc.text('CONSUMER INFORMATION', MARGIN, y + 4, { width: CONTENT_WIDTH, align: 'center' });
  y += sectionBandH + 4;

  // --- INFO TABLE ---
  const labelCol = MARGIN;
  const colonCol = MARGIN + 175;
  const valueCol = colonCol + 12;
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

  // --- INVERTER PHOTO HEADING ---
  y = drawPhotoHeading(doc, 'Inverter Photo', y);

  // --- INVERTER PHOTO ---
  const photo1BoxY = y;
  const photo1BoxHeight = FOOTER_LINE_Y - 10 - photo1BoxY;

  if (photo1BoxHeight > 30) {
    drawContainedImage(doc, img1, MARGIN, photo1BoxY, CONTENT_WIDTH, photo1BoxHeight);
  }

  drawFooter(doc);

  // ─────────────────────────────────────────────
  // PAGE 2 — Panel Photo (upper) + Earth Photo (lower)
  // ─────────────────────────────────────────────
  doc.addPage({ size: 'A4', margin: 0 });

  const page2Top = MARGIN;
  const totalPage2Height = FOOTER_LINE_Y - 10 - page2Top;
  // Reserve some space for the "Earth Photo" label in the lower half
  const labelHeight = 18; // heading text + gap
  const gapBetween = 10;

  const upperHalfHeight = Math.floor((totalPage2Height - gapBetween - labelHeight) / 2);

  // Panel Photo heading + image — upper half
  let p2y = page2Top;
  p2y = drawPhotoHeading(doc, 'Panel Photo', p2y);
  const panelBoxHeight = upperHalfHeight - labelHeight;
  drawContainedImage(doc, img2, MARGIN, p2y, CONTENT_WIDTH, panelBoxHeight);
  p2y += panelBoxHeight + gapBetween / 2;

  // Dashed divider
  drawDashedLine(doc, p2y);
  p2y += gapBetween / 2;

  // Earth Photo heading + image — lower half
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
    // Two photos: split page in half
    const totalPage3Height = FOOTER_LINE_Y - 10 - p3y;
    const upperHeight = Math.floor((totalPage3Height - gapBetween - labelHeight) / 2);

    // LA Photo
    p3y = drawPhotoHeading(doc, 'LA Photo', p3y);
    const laBoxHeight = upperHeight - labelHeight;
    drawContainedImage(doc, img4, MARGIN, p3y, CONTENT_WIDTH, laBoxHeight);
    p3y += laBoxHeight + gapBetween / 2;

    drawDashedLine(doc, p3y);
    p3y += gapBetween / 2;

    // 5th Photo
    p3y = drawPhotoHeading(doc, 'Photograph 5', p3y);
    const photo5BoxHeight = FOOTER_LINE_Y - 10 - p3y;
    if (photo5BoxHeight > 30) {
      drawContainedImage(doc, img5, MARGIN, p3y, CONTENT_WIDTH, photo5BoxHeight);
    }
  } else {
    // Only LA Photo: use the full page
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
