'use strict';

const { existsSync } = require('node:fs');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { serviceName, thaiDate, thaiDateTime } = require('../../lib/format');

const THAI_FONT = '/usr/share/fonts/truetype/tlwg/Garuda.ttf';

async function makePdf(document, verifyUrl) {
  const { docNo, caseNo, verifyCode, applicant, serviceId, issuedAt, validUntil, signer } = document;
  const qr = await QRCode.toBuffer(verifyUrl, { scale: 6 });
  const hasThaiFont = existsSync(THAI_FONT);
  const pdf = new PDFDocument({
    size: 'A4',
    lang: hasThaiFont ? 'th-TH' : 'en',
    info: {
      Title: docNo,
      CreationDate: new Date(issuedAt),
      // PDFKit encodes page glyphs as hex. The info dictionary keeps the contract line in ASCII.
      Keywords: `docNo=${docNo} caseNo=${caseNo} verify=${verifyCode} validUntil=${validUntil}`,
    },
  });

  return new Promise((resolve, reject) => {
    const chunks = [];
    pdf.on('data', (chunk) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    if (hasThaiFont) {
      // Garuda's ccmp substitutions can share glyphs between different Thai marks in the PDF text map.
      const thaiText = { features: { ccmp: false } };
      pdf.font(THAI_FONT).fontSize(23).text('เอกสารดิจิทัล เทศบาลในฝัน', thaiText).moveDown();
      pdf.fontSize(14);
      const details = [
        `เลขเอกสาร ${docNo}`,
        `เลขคำขอ ${caseNo}`,
        `ผู้ยื่น ${applicant}`,
        `บริการ ${serviceId} ${serviceName(serviceId)}`,
        `วันออก ${thaiDateTime(issuedAt)}`,
        `ใช้ได้ถึง ${thaiDate(validUntil)}`,
        `ผู้ลงนาม ${signer}`,
        `รหัสตรวจสอบ ${verifyCode}`,
      ];
      for (const line of details) pdf.text(line, thaiText);
    } else {
      pdf.fontSize(21).text('Digital document').moveDown().fontSize(12);
      pdf.text(`Document ${docNo}`);
      pdf.text(`Case ${caseNo}`);
      pdf.text(`Service ${serviceId}`);
      pdf.text(`Issued ${issuedAt}`);
      pdf.text(`Valid until ${validUntil}`);
      pdf.text(`Verification code ${verifyCode}`);
    }
    pdf.moveDown();
    pdf.link(pdf.x, pdf.y, 112, 112, verifyUrl);
    pdf.image(qr, { width: 112 });
    pdf.end();
  });
}

module.exports = { makePdf };
