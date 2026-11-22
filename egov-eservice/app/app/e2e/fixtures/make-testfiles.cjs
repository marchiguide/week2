// สร้างไฟล์ทดสอบอัปโหลดตาม TEST-DATA ข้อ 11 (พอร์ตจาก make_testfiles.py ให้ได้ไบต์เดียวกัน)
// ใช้: node fixtures/make-testfiles.cjs  → เขียนลง fixtures/testfiles/
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const TESTFILES_DIR = path.join(__dirname, 'testfiles');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }

/** PDF จริงขนาด n ไบต์ (หัว %PDF + เติมช่องว่างแล้วปิดด้วย %%EOF) */
function pdf(n) {
  const head = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n', 'latin1');
  const tail = Buffer.from('\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
  const pad = n - head.length - tail.length;
  if (pad < 0) throw new Error('pdf too small');
  return Buffer.concat([head, Buffer.alloc(pad, 0x20), tail]);
}

/** PNG จริง 1x1 + เติม chunk tEXt ให้ครบขนาด */
function png(n) {
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'latin1');
    return Buffer.concat([u32(data.length), t, data, u32(crc32(Buffer.concat([t, data])))]);
  };
  const ihdr = Buffer.concat([u32(1), u32(1), Buffer.from([8, 2, 0, 0, 0])]);
  const base = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0x00, 0xff, 0x00, 0x00]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const pad = n - base.length - 12;
  const text = Buffer.concat([Buffer.from([0x6b, 0x00]), Buffer.alloc(pad - 2, 0x78)]);
  return Buffer.concat([base.subarray(0, base.length - 12), chunk('tEXt', text), base.subarray(base.length - 12)]);
}

/** JPEG จริงแบบย่อ: SOI + APP0 + COM เติม + EOI */
function jpg(n) {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const pad = n - soi.length - app0.length - 2 - 4;
  return Buffer.concat([soi, app0, Buffer.from([0xff, 0xfe]), u16(pad + 2), Buffer.alloc(pad, 0x78), Buffer.from([0xff, 0xd9])]);
}

/** ชื่อไฟล์ → เนื้อไฟล์ ตามตาราง TEST-DATA ข้อ 11 */
function specs() {
  const out = {};
  for (const n of ['ok-id.pdf', 'id-card.pdf', 'map.pdf', 'plan.pdf', 'deed.pdf', ...[1, 2, 3, 4, 5, 6].map((i) => `multi-${i}.pdf`)]) {
    out[n] = () => pdf(1024);
  }
  out['real.jpg'] = () => jpg(1024);
  out['real.png'] = () => png(1024);
  out['plan-as-jpg.jpg'] = () => jpg(1024);
  for (const n of [5242879, 5242880, 5242881]) out[`size-${n}.pdf`] = () => pdf(n);
  out['fake-text.pdf'] = () => Buffer.from('hello');
  out['fake-text.jpg'] = () => Buffer.from('hello');
  out['notes.txt'] = () => Buffer.from('hello');
  out['exe-as.png'] = () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1022)]);
  return out;
}

/** เขียนไฟล์ที่ยังไม่มีหรือเนื้อไม่ตรง (idempotent) */
function ensureTestFiles() {
  fs.mkdirSync(TESTFILES_DIR, { recursive: true });
  for (const [name, make] of Object.entries(specs())) {
    const data = make();
    const p = path.join(TESTFILES_DIR, name);
    if (fs.existsSync(p) && fs.statSync(p).size === data.length && fs.readFileSync(p).equals(data)) continue;
    fs.writeFileSync(p, data);
  }
  return TESTFILES_DIR;
}

module.exports = { TESTFILES_DIR, ensureTestFiles, pdf, png, jpg, specs };

if (require.main === module) {
  ensureTestFiles();
  for (const f of fs.readdirSync(TESTFILES_DIR).sort()) console.log(f, fs.statSync(path.join(TESTFILES_DIR, f)).size);
}
