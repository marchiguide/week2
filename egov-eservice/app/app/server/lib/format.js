'use strict';
/**
 * Display formatting (CONTRACT §0.2 §0.3 · DECISIONS §0 §11 §18 · A-04 A-24 A-51 A-54).
 *
 *   thaiDateTime(x)  '4 ธ.ค. 2569 16:30'          thaiDate(x)  '4 ธ.ค. 2569'   (x = Date|ms|ISO|'YYYY-MM-DD')
 *   iso(x)           '2026-12-04T16:30:00+07:00'   → put in data-iso="" on every date element
 *   timeHtml(x, testid, extraAttrs)  <time data-testid=.. data-iso=.. datetime=..>4 ธ.ค. 2569 16:30</time>
 *   money(1010)      '฿1,010'                      number(1010) '1,010'
 *   formatId('1101700123456') '1-1017-00123-45-6'   maskId(...) 'X-XXXX-XXXXX-45-6'
 *   maskName('สมชาย ใจดี')   'สมชาย ใ***'
 *   isValidThaiId(s)  13 digits + checksum
 *   statusText / levelText / roleText / serviceName / docName  (code → Thai)
 *   pct(n, d)  ontime %: 1 decimal, round half up, null when d = 0 · pctText → '85.7%' or '–'
 */
const clock = require('./clock');
const codes = require('./codes');

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const EN_DASH = '–'; // U+2013

const pad = (n) => String(n).padStart(2, '0');

function thaiDate(x) {
  const p = clock.parts(x);
  if (!p) return '';
  return `${p.day} ${TH_MONTHS[p.month - 1]} ${p.beYear}`;
}
function thaiDateTime(x) {
  const p = clock.parts(x);
  if (!p) return '';
  return `${p.day} ${TH_MONTHS[p.month - 1]} ${p.beYear} ${pad(p.hour)}:${pad(p.minute)}`;
}
/** 'ธันวาคม 2569' for a 'YYYY-MM' period */
function thaiMonth(period) {
  const [y, m] = String(period).split('-').map(Number);
  if (!y || !m) return '';
  return `${TH_MONTHS_FULL[m - 1]} ${y + 543}`;
}
function iso(x) { return clock.toIso(x); }

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * <time> element with data-iso (A-51). Use with <%- %> in EJS.
 * @param x        date value (null → '–')
 * @param testid   data-testid (optional)
 * @param attrs    extra attributes object, e.g. {class:'due'}
 * @param opts     {dateOnly:true} → '4 ธ.ค. 2569'
 */
function timeHtml(x, testid, attrs = {}, opts = {}) {
  const isoStr = x == null || x === '' ? null : iso(x);
  const a = Object.entries(attrs || {}).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('');
  const tid = testid ? ` data-testid="${escapeHtml(testid)}"` : '';
  if (!isoStr) return `<span${tid}${a}>${EN_DASH}</span>`;
  const text = opts.dateOnly ? thaiDate(x) : thaiDateTime(x);
  return `<time${tid} data-iso="${isoStr}" datetime="${isoStr}"${a}>${text}</time>`;
}

function number(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '';
  return Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function money(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '';
  const v = Math.round(Number(n));
  return (v < 0 ? '-' : '') + '฿' + number(Math.abs(v));
}

function digitsOnly(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

/** '1101700123456' → '1-1017-00123-45-6' */
function formatId(idNo) {
  const d = digitsOnly(idNo);
  if (d.length !== 13) return String(idNo || '');
  return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
}
/** '1101700123456' → 'X-XXXX-XXXXX-45-6' (last 3 digits visible, A-24) */
function maskId(idNo) {
  const d = digitsOnly(idNo);
  if (d.length !== 13) return 'X-XXXX-XXXXX-XX-X';
  return `X-XXXX-XXXXX-${d.slice(10, 12)}-${d[12]}`;
}
/** 'สมชาย ใจดี' → 'สมชาย ใ***' (A-54) */
function maskName(name) {
  const s = String(name || '').trim();
  const i = s.indexOf(' ');
  if (i < 0) return s;
  const first = s.slice(0, i);
  const last = s.slice(i + 1).trim();
  const initial = Array.from(last)[0] || '';
  return `${first} ${initial}***`;
}

/** 13 digits exactly + checksum: d13 = (11 − Σ dᵢ×(14−i), i=1..12 mod 11) mod 10 (DECISIONS §2) */
function isValidThaiId(s) {
  const str = String(s == null ? '' : s);
  if (!/^\d{13}$/.test(str)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(str[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(str[12]);
}

/** 10 digits starting with 0 (DECISIONS §2) */
function isValidMobile(s) { return /^0\d{9}$/.test(String(s == null ? '' : s)); }

const statusText = (c) => codes.STATUS[c] || String(c || '');
const levelText = (c) => codes.LEVEL[c] || String(c || '');
const roleText = (c) => codes.ROLE[c] || String(c || '');
const deptText = (c) => codes.DEPT[c] || String(c || '');
const serviceName = (id) => (codes.SERVICES[id] ? codes.SERVICES[id].name : String(id || ''));
const docName = (k) => codes.DOC_NAME[k] || String(k || '');

/** n/d×100 with 1 decimal, round half up, exact integer arithmetic. d = 0 → null. */
function pct(n, d) {
  n = Number(n); d = Number(d);
  if (!d) return null;
  const num = n * 1000;
  let q = Math.floor(num / d);
  const r = num - q * d;
  if (2 * r >= d) q += 1;
  return q / 10;
}
/** 85.7 → '85.7%' · 100 → '100.0%' · null → '–' */
function pctText(v) { return v == null ? EN_DASH : `${Number(v).toFixed(1)}%`; }

module.exports = {
  TH_MONTHS, TH_MONTHS_FULL, TH_WEEKDAYS, EN_DASH,
  thaiDate, thaiDateTime, thaiMonth, iso, timeHtml, escapeHtml,
  number, money, formatId, maskId, maskName, isValidThaiId, isValidMobile, digitsOnly,
  statusText, levelText, roleText, deptText, serviceName, docName,
  pct, pctText,
};
