#!/usr/bin/env node
/* B13 · Summarise e2e/reports/bugs/<mode>.json (Playwright JSON reporter) into the BUGS.md §4 table
 * plus a §5 triage verdict and the first assertion line of every failed TC.
 * Usage: node scripts/summarize-bugs.cjs [dir]   (default e2e/reports/bugs) */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || path.join(__dirname, '..', 'e2e', 'reports', 'bugs');

// BUGS.md §2 / TEST-PLAN §18: "TC ที่ต้องล้ม" and "TC ที่อาจล้มด้วย"
const EXPECT = {
  B01: { must: ['TC-FEE-01'], may: [] },
  B02: { must: ['TC-UPLOAD-01'], may: [] },
  B03: { must: ['TC-SLA-01', 'TC-SLA-02'], may: ['TC-SLA-03', 'TC-RBAC-04'] },
  B04: { must: ['TC-SLA-02'], may: [] },
  B05: { must: ['TC-PAY-01'], may: [] },
  B06: { must: ['TC-RBAC-01'], may: [] },
  B07: { must: ['TC-RBAC-02'], may: ['TC-WORKFLOW-01'] },
  B08: { must: ['TC-QUEUE-02'], may: [] },
  B09: { must: ['TC-PDPA-02'], may: [] },
  B10: { must: ['TC-DASH-02'], may: ['TC-DASH-01', 'TC-DASH-03'] },
  B11: { must: ['TC-PDPA-03', 'TC-AUDIT-01'], may: [] },
  B12: { must: ['TC-WORKFLOW-04'], may: [] },
};

function expectFor(tag) {
  if (/^none/.test(tag)) return { must: [], may: [] };
  const must = new Set(), may = new Set();
  for (const b of tag.split('+')) {
    const e = EXPECT[b];
    if (!e) continue;
    e.must.forEach(t => must.add(t));
    e.may.forEach(t => may.add(t));
  }
  return { must: [...must], may: [...may].filter(t => !must.has(t)) };
}

function collect(json) {
  const out = [];
  (function walk(suite) {
    for (const spec of suite.specs || []) {
      const id = (spec.title.match(/TC-[A-Z]+-\d+/) || [spec.title])[0];
      for (const t of spec.tests || []) {
        const last = t.results[t.results.length - 1] || {};
        const err = (last.errors && last.errors[0]) || last.error || {};
        const msg = String(err.message || '').replace(/\u001b\[[0-9;]*m/g, '');
        out.push({ id, status: last.status || t.status, ms: last.duration || 0, msg });
      }
    }
    (suite.suites || []).forEach(walk);
  })({ suites: json.suites });
  return out;
}

function firstLines(msg) {
  const lines = msg.split('\n').map(s => s.trim()).filter(Boolean);
  const keep = lines.filter(l => /^(Error|Expected|Received|expect|Locator|.*overflow|.*status)/i.test(l)).slice(0, 4);
  return (keep.length ? keep : lines.slice(0, 3)).join(' · ').replace(/\|/g, '\\|').slice(0, 400);
}

const ORDER = ['none', 'none-again', 'B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12', 'B03+B07', 'B01+B05+B09', 'none-final'];
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
files.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

const rows = [], details = [];
for (const tag of files) {
  const json = JSON.parse(fs.readFileSync(path.join(dir, tag + '.json'), 'utf8'));
  const res = collect(json);
  const failed = res.filter(r => r.status !== 'passed' && r.status !== 'skipped');
  const passed = res.filter(r => r.status === 'passed').length;
  const { must, may } = expectFor(tag);
  const failedIds = failed.map(r => r.id);
  const missed = must.filter(t => !failedIds.includes(t));
  const extra = failedIds.filter(t => !must.includes(t) && !may.includes(t));
  const sideEffect = failedIds.filter(t => may.includes(t));
  // BUGS §3 step 4: a failure must show expected vs received, not a bare timeout / missing element
  const timeouts = failed.filter(r => r.status === 'timedOut' || !/Expected|Received|expected|received/.test(r.msg)).map(r => r.id);
  let verdict;
  if (/^none/.test(tag)) verdict = failed.length === 0 && res.length === 51 ? `✅ ${passed}/${res.length} passed` : `❌ ${passed}/${res.length} passed`;
  else if (missed.length) verdict = '❌ test ผ่านหลอก (TC ที่ต้องล้มกลับผ่าน)';
  else if (extra.length) verdict = '❌ บั๊กรั่วเกินจุด (มี TC นอกตารางล้ม)';
  else verdict = `✅ จับได้ตรงจุด${sideEffect.length ? ' (+ผลข้างเคียงที่ยอมรับ)' : ''}`;
  rows.push({ tag, total: res.length, passed, must, may, failedIds, extra, missed, sideEffect, timeouts, verdict });
  for (const f of failed) details.push({ tag, id: f.id, status: f.status, msg: firstLines(f.msg) });
}

const label = t => t.replace(/\+/g, ',');
const list = a => (a.length ? a.join(' · ') : '–');
console.log('| บั๊ก | TC ที่คาดว่าล้ม | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผ่าน/ทั้งหมด | ผล |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) {
  const expected = r.must.length ? list(r.must) + (r.may.length ? ` (อาจล้ม: ${list(r.may)})` : '') : '–';
  console.log(`| ${label(r.tag)} | ${expected} | ${list(r.failedIds)} | ${list(r.extra)} | ${list(r.missed)} | ${r.passed}/${r.total} | ${r.verdict} |`);
}
console.log('\n### ข้อความที่ล้ม (BUGS §3 ขั้น 4)\n');
console.log('| โหมด | TC | สถานะ | ข้อความ assert |');
console.log('|---|---|---|---|');
for (const d of details) console.log(`| ${label(d.tag)} | ${d.id} | ${d.status} | ${d.msg} |`);
const bad = rows.filter(r => r.timeouts.length);
if (bad.length) console.log('\n> ⚠️ มี TC ล้มด้วย timeout/หา element ไม่เจอ: ' + bad.map(r => `${label(r.tag)}: ${r.timeouts.join(',')}`).join(' · '));
