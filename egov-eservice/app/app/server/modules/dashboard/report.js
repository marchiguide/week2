'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { EN_DASH, pctText } = require('../../lib/format');

function kpiRows({ received, closed, ontimePct, backlog, overdue }) {
  return [
    { id: 'received', label: 'รับเรื่อง', value: String(received) },
    { id: 'closed', label: 'ปิดงาน', value: String(closed) },
    { id: 'ontime-pct', label: 'ทันกำหนด %', value: pctText(ontimePct) },
    { id: 'backlog', label: 'งานคงค้าง', value: String(backlog) },
    { id: 'overdue', label: 'เกินกำหนดคงค้าง', value: String(overdue) },
  ];
}

async function createWorkbook(rows, generatedAt) {
  const book = new ExcelJS.Workbook();
  book.created = generatedAt;
  book.modified = generatedAt;
  const sheet = book.addWorksheet('Dashboard');
  sheet.columns = [
    { header: 'ตัวชี้วัด', width: 28 },
    { header: 'ค่า', width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const { label, value } of rows) sheet.addRow([label, value]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function createPdf(rows, { period, service }, generatedAt) {
  const [received, closed, ontime, backlog, overdue] = rows.map(({ value }) => value);
  const kpiLine = `kpi received=${received} closed=${closed} ontime=${ontime === EN_DASH ? '-' : ontime} backlog=${backlog} overdue=${overdue}`;
  const doc = new PDFDocument({
    size: 'A4',
    info: {
      Title: 'Dashboard report',
      CreationDate: generatedAt,
      // Preserve the plain ASCII line in the file in addition to the rendered text.
      Keywords: kpiLine,
    },
  });
  doc.fontSize(20).text('Dashboard report');
  doc.moveDown(0.5).fontSize(12).text(`${period} / ${service}`);
  doc.moveDown().font('Courier').fontSize(10).text(kpiLine, { lineBreak: false });
  doc.end();
  return Buffer.concat(await doc.toArray());
}

module.exports = { kpiRows, createWorkbook, createPdf };
