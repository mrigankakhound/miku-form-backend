const PDFDocument = require('pdfkit');
const axios = require('axios');

// A4 dimensions in points
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

// Footer height reservation
const FOOTER_HEIGHT = 60;
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
 * Draw footer on the current page
 */
function drawFooter(doc) {
  const footerLines = [
    'Call - 7002322258 / 8254028956',
    'Location - Pulibor, Jorhat-785006, Assam',
    'Mail - contact@drtweb.in',
    'Web - www.drtweb.in',
  ];

  // Horizontal line above footer
  doc
    .moveTo(MARGIN, FOOTER_LINE_Y)
    .lineTo(A4_WIDTH - MARGIN, FOOTER_LINE_Y)
    .lineWidth(0.5)
    .strokeColor('black')
    .stroke();

  let y = FOOTER_LINE_Y + 6;
  doc.font('Helvetica').fontSize(8).fillColor('black');

  for (const line of footerLines) {
    doc.text(line, MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y += 12;
  }
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
 * Draw a photo section heading with a separator line
 */
function drawPhotoHeading(doc, label, y) {
  doc.font('Helvetica-Bold').fontSize(10).fillColor('black');
  doc.text(label, MARGIN, y, { width: CONTENT_WIDTH });
  return y + 14;
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

  // --- HEADER ---
  doc.font('Helvetica-Bold').fontSize(18).fillColor('black');
  doc.text('DRT ENTERPRISE', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
  y += 24;

  doc.font('Helvetica').fontSize(10);
  doc.text('GSTIN: 18ABXFM0804A1ZE', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
  y += 16;

  // Horizontal rule under header
  doc.moveTo(MARGIN, y).lineTo(A4_WIDTH - MARGIN, y).lineWidth(0.75).strokeColor('black').stroke();
  y += 12;

  // --- CONSUMER INFORMATION TITLE ---
  doc.font('Helvetica-Bold').fontSize(11).fillColor('black');
  doc.text('CONSUMER INFORMATION', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
  y += 16;

  // --- INFO TABLE ---
  const labelCol = MARGIN;
  const colonCol = MARGIN + 175;
  const valueCol = colonCol + 12;
  const valueWidth = A4_WIDTH - MARGIN - valueCol;

  const fields = [
    ['Consumer Name', record.consumerName],
    ['Consumer No', record.consumerNo],
    ['Contact Number', record.contactNumber],
    ['Application Reference No', record.applicationReferenceNo],
    ['Address', record.address],
    ['Plant Capacity', record.plantCapacity],
    ['Installation Date', formatDate(record.installationDate)],
    ['Sub-Division', record.subDivision],
    ['Date of System Commissioning', formatDate(record.systemCommissioningDate)],
    ['Vendor Name', record.vendorName],
  ];

  doc.fontSize(10);

  for (const [label, value] of fields) {
    const valueHeight = doc.heightOfString(String(value || ''), {
      width: valueWidth,
      lineGap: 2,
    });
    const rowHeight = Math.max(16, valueHeight + 4);

    doc.font('Helvetica-Bold').fillColor('black');
    doc.text(label, labelCol, y, { width: 170, lineBreak: false });

    doc.font('Helvetica').text(':', colonCol, y, { lineBreak: false });

    doc.font('Helvetica').fillColor('black');
    doc.text(String(value || ''), valueCol, y, { width: valueWidth, lineGap: 2 });

    y += rowHeight + 2;
  }

  y += 8;

  // Separator before photo
  doc.moveTo(MARGIN, y).lineTo(A4_WIDTH - MARGIN, y).lineWidth(0.5).stroke();
  y += 10;

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
