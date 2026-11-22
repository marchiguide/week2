'use strict';
/**
 * Crypto helpers (DECISIONS §11 · NFR-04 · CONTRACT §3).
 *
 *   encrypt(plain) / decrypt(blob)   AES-256-GCM for idNo + mobile at rest. Output 'v1.<b64url iv|tag|ct>'
 *   blindIndex(value)                deterministic keyed hash (HMAC-SHA256, base64url) to look up a
 *                                    citizen by idNo without storing it in clear: WHERE id_hash = ?
 *   hashPassword / verifyPassword    scrypt for staff passwords ('scrypt$<salt>$<hash>')
 *   hashPasswordCached(pw)           same, memoized per plaintext (use in seed → fast reset)
 *   signDocument(fields)             simulated signature HMAC-SHA256 over
 *                                    docNo|caseNo|applicant|serviceId|issuedAt|validUntil|signer (A-22)
 *   randomToken / randomCode         session ids, verify codes
 *
 * Never store or log a 13-digit id or 10-digit mobile in clear (TC-NFR-04 greps the DB file).
 */
const crypto = require('crypto');
const config = require('./config');

const ENC_KEY = crypto.createHash('sha256').update('enc:' + config.appSecret).digest(); // 32 bytes
const IDX_KEY = crypto.createHash('sha256').update('idx:' + config.appSecret).digest();
const DOC_KEY = Buffer.from(config.docHmacKey, 'utf8');

function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1.' + Buffer.concat([iv, tag, ct]).toString('base64url');
}

function decrypt(blob) {
  if (blob == null || blob === '') return null;
  const s = String(blob);
  if (!s.startsWith('v1.')) throw new Error('decrypt: unknown format');
  const buf = Buffer.from(s.slice(3), 'base64url');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/** Keyed deterministic hash for equality lookups (normalizes by removing non-digits for ids). */
function blindIndex(value) {
  return crypto.createHmac('sha256', IDX_KEY).update(String(value)).digest('base64url');
}

// ---------------------------------------------------------------- passwords
const SCRYPT_N = 16384;
function hashPassword(pw, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(String(pw), salt, 32, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
function verifyPassword(pw, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const got = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64url'), expected.length, { N: SCRYPT_N, r: 8, p: 1 });
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}
const pwCache = new Map();
function hashPasswordCached(pw) {
  if (!pwCache.has(pw)) pwCache.set(pw, hashPassword(pw));
  return pwCache.get(pw);
}

// ---------------------------------------------------------------- simulated digital signature
/** Field order is fixed by CONTRACT §3. */
const DOC_SIGN_FIELDS = ['docNo', 'caseNo', 'applicant', 'serviceId', 'issuedAt', 'validUntil', 'signer'];

/**
 * HMAC-SHA256 (hex) of the document fields joined with '|'.
 * Use the SAME string formats when signing (seed B02 / issue B07) and verifying (B07):
 *   issuedAt = ISO '+07:00' as stored (e.g. '2026-11-05T10:00:00+07:00'), validUntil = 'YYYY-MM-DD',
 *   applicant = full name as stored, signer = display name as stored.
 * @param {object} f object with the 7 fields (or an array in that order)
 */
function signDocument(f) {
  const values = Array.isArray(f) ? f : DOC_SIGN_FIELDS.map((k) => (f[k] == null ? '' : String(f[k])));
  return crypto.createHmac('sha256', DOC_KEY).update(values.join('|'), 'utf8').digest('hex');
}
function verifyDocumentSignature(f, signature) {
  const expected = Buffer.from(signDocument(f), 'hex');
  const got = Buffer.from(String(signature || ''), 'hex');
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

// ---------------------------------------------------------------- random
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
/** Random code from an unambiguous alphabet (e.g. verify code, 8 chars). */
function randomCode(len = 8, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

module.exports = {
  encrypt, decrypt, blindIndex,
  hashPassword, verifyPassword, hashPasswordCached,
  DOC_SIGN_FIELDS, signDocument, verifyDocumentSignature,
  randomToken, randomCode,
};
