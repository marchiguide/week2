'use strict';
/**
 * multipart/form-data parsing (multer, memory storage). The size limit here is deliberately ABOVE
 * 5 MB so the module itself can answer 400 FILE_TOO_LARGE 'ไฟล์ใหญ่เกิน 5 MB' for 5,242,881 bytes
 * (CONTRACT §0.10 — never a framework 413). Check `file.size > codes.MAX_FILE_BYTES` yourself.
 *
 *   const upload = require('../../lib/upload');
 *   router.post('/api/drafts/:id/files', requireRole('citizen'), upload.single('file'), (req, res) => {
 *     req.file  → { originalname (UTF-8 fixed), buffer, size, mimetype(client-claimed: ignore) }
 *     req.body.docKey
 *   });
 *   upload.any()  → req.files[] (resubmit with optional files)
 *
 *   upload.sniff(buffer) → 'application/pdf' | 'image/jpeg' | 'image/png' | null   (magic bytes only)
 */
const multer = require('multer');
const { sendError } = require('./errors');

const HARD_LIMIT = 20 * 1024 * 1024; // 20 MB per file, far above the 5 MB business rule

const m = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HARD_LIMIT, files: 20, fields: 100, fieldSize: 1024 * 1024 },
});

/** busboy decodes non-ASCII filenames as latin1 — re-decode as UTF-8 when that yields valid text. */
function fixName(name) {
  if (!name) return name;
  if (/[^\u0000-ÿ]/.test(name)) return name; // already has non-latin1 chars → fine
  const re = Buffer.from(name, 'latin1').toString('utf8');
  return re.includes('�') ? name : re;
}

function wrap(mw) {
  return (req, res, next) => mw(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, 'FILE_TOO_LARGE');
      if (err.code === 'LIMIT_FILE_COUNT') return sendError(res, 'FILE_COUNT');
      return sendError(res, 'BAD_REQUEST', {}, `อัปโหลดไม่สำเร็จ: ${err.message}`);
    }
    if (req.file) req.file.originalname = fixName(req.file.originalname);
    if (Array.isArray(req.files)) req.files.forEach((f) => { f.originalname = fixName(f.originalname); });
    next();
  });
}

function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf'; // %PDF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  return null;
}

module.exports = {
  single: (field = 'file') => wrap(m.single(field)),
  any: () => wrap(m.any()),
  sniff,
  HARD_LIMIT,
};
