# TEST-REPORT · e-Service เทศบาลในฝัน · Playwright 51 TC + BUG_MODE B01–B12

> B13 (รวมระบบ + ทดสอบสุดท้าย) · รันจริงบน Docker Compose · อ้างอิง BUGS.md §1–§6 · TEST-PLAN.md §1 §17 §18 · CONTRACT.md §8
> ผลชุดสุดท้าย (รอบ 2): image `egov-eservice-web:latest` build 2026-11-21 20:25 (+07:00) และไม่มีการแก้ซอร์สหลังจากนั้น · รันวันที่ 21–22 พ.ย. 2569

## สรุปตามเกณฑ์ done

| เกณฑ์ | ผล |
|---|---|
| `BUG_MODE` ว่าง = 51/51 ผ่าน | ✅ **51/51** สามรอบ: `none` (รอบแรกหลังสตาร์ตเว็บ) · `none-again` (รันซ้ำทันทีโดยไม่ restart) · `none-final` (ปิดบั๊กทั้งหมดอีกครั้ง) · ไม่มี flaky ไม่มี skipped · `retries: 0` |
| B01–B12 TC ที่ BUGS §2 บอกว่า "ต้องล้ม" ล้มจริง | ✅ ครบ 12/12 · ไม่มี TC ใดล้มนอกตาราง (มีแค่ "TC ที่อาจล้มด้วย" ที่ยอมรับได้ ใน B03 และ B10) |
| ข้อความที่ล้มบอกค่าที่คาดหวังกับค่าจริง (BUGS §3 ขั้น 4) | ✅ ทุก TC ที่ล้มเป็น assert ค่า (`Expected … Received …`) ไม่มีตัวไหนล้มเพราะ timeout หรือหา element ไม่เจอ |
| รวมบั๊ก (BUGS §3 ขั้น 5) | ✅ `B03,B07` และ `B01,B05,B09` ล้มเท่ากับ union ของแต่ละตัวพอดี |
| ตาราง triage | ✅ 12 แถว (§5) |

## 1. วิธีรัน

```bash
# ที่โฟลเดอร์ /workspace/plans/egov-eservice/app (มี docker-compose.yml)
TEST_MODE=1 BUG_MODE= HOST_PORT=8080 docker compose up --build -d     # เว็บถูกต้อง
cd app/e2e && npm ci
BASE_URL=http://localhost:8080 DB_PATH=$PWD/../../data/egov.db npx playwright test   # → 51 passed

# ชุดเต็มทุกโหมดในคำสั่งเดียว (≈35 นาที):
#   none, none-again, B01…B12, B03,B07, B01,B05,B09, none-final
app/scripts/run-bugs.sh
NO_BUILD=1 app/scripts/run-bugs.sh B08 B09        # รันเฉพาะบางโหมด
```

ทุกโหมด `run-bugs.sh` จะทำงานตามลำดับนี้
1. `docker compose up -d --force-recreate web` ด้วย `TEST_MODE=1 BUG_MODE=<โหมด>`
2. รอให้ `/api/health` ตอบ
3. **ตรวจ banner ตอนสตาร์ตว่าแสดง `BUG_MODE` ตรงกับที่ตั้งไว้** (BUGS §5 "พิมพ์ BUG_MODE ออกมาดู") ถ้าไม่ตรงจะหยุดทันที
4. `npx playwright test` (workers 1, retries 0)
5. `scripts/summarize-bugs.cjs` สรุปผลเป็น `e2e/reports/bugs/summary.md`

| สภาพแวดล้อม | ค่า |
|---|---|
| เว็บ | `egov-eservice-web-1` · Node + Express + SQLite (better-sqlite3) · พอร์ตโฮสต์ 8080 → 3000 · DB bind mount `./data/egov.db` |
| Playwright | `@playwright/test` 1.65.1 · Chromium (headless shell) · `workers: 1` · `retries: 0` · `timeout 180 s` · `expect 10 s` |
| ไลบรารีจาก `tests/part2/DEPS.md` (รวมเข้า `e2e/package.json` แล้ว) | `@axe-core/playwright` 4.14.0 · `exceljs` 4.4.0 · `pdf-parse` 2.4.5 (ติดตั้งจริงตามเวอร์ชันนี้) |
| ตัวแปรที่ส่งให้ test | `BASE_URL=http://localhost:8080` · `DB_PATH=<root>/data/egov.db` (TC-NFR-04) · `DB_ENCRYPTION_METHOD="AES-256-GCM (server/lib/crypto.js) + HMAC blind index"` |
| browser shim | Playwright 1.65.1 ต้องใช้ chromium build 1255 แต่ image มีแค่ 1254 จึงให้สคริปต์สร้าง symlink 1255 → 1254 ไว้ที่ `/tmp/pw-browsers` แล้วตั้ง `PLAYWRIGHT_BROWSERS_PATH` (เป็นเรื่องสภาพแวดล้อม ไม่ได้แก้โค้ด) |
| ตรวจประกอบ | `npx tsc --noEmit` ใน e2e ผ่าน (exit 0) · `npm run test:rules` (node --test server/rules) 22/22 ผ่าน |

## 2. ผลเว็บถูกต้อง (`BUG_MODE` ว่าง)

| รอบ | ความหมาย (BUGS §3) | ผล | เวลา |
|---|---|---|---|
| `none` | ขั้น 1 ชุดเต็มหลังสตาร์ตเว็บ | ✅ 51 passed | 1.6 นาที |
| `none-again` | ขั้น 2 รันซ้ำทันทีโดยไม่ restart (พิสูจน์ว่า reset ให้ผลซ้ำได้) | ✅ 51 passed | 1.6 นาที |
| `none-final` | ขั้น 6 ปิดบั๊กทั้งหมดอีกครั้งหลังรันทุกโหมด | ✅ 51 passed (`expected 51 · unexpected 0 · flaky 0 · skipped 0`) | 2.2 นาที |

รายละเอียดราย TC (`none-final`) ผ่านครบทั้ง 51 ตัว

| ไฟล์ | TC (ผ่าน · วินาที) |
|---|---|
| part1/auth.spec.ts | AUTH-01 2.2 · AUTH-02 1.3 · AUTH-03 2.0 · AUTH-04 5.6 |
| part1/fee.spec.ts | FEE-01 1.3 |
| part1/submit.spec.ts | SUBMIT-01 1.4 · SUBMIT-02 1.1 · SUBMIT-03 3.0 |
| part1/upload.spec.ts | UPLOAD-01 1.6 · UPLOAD-02 1.1 |
| part1/pay.spec.ts | PAY-01 0.9 · PAY-02 0.3 · PAY-03 0.5 · PAY-04 0.8 |
| part1/queue.spec.ts | QUEUE-01 1.8 · QUEUE-02 2.5 · QUEUE-03 2.6 |
| part1/sla.spec.ts | SLA-01 3.5 · SLA-02 3.0 · SLA-03 3.3 |
| part1/noti.spec.ts | NOTI-01 1.9 · NOTI-02 5.1 |
| part2/workflow.spec.ts | WORKFLOW-01 1.4 · WORKFLOW-02 2.5 · WORKFLOW-03 2.3 · WORKFLOW-04 4.2 · WORKFLOW-05 2.3 · WORKFLOW-06 1.5 |
| part2/doc.spec.ts | DOC-01 0.9 · DOC-02 0.4 · DOC-03 2.8 |
| part2/pdpa.spec.ts | PDPA-01 1.3 · PDPA-02 0.5 · PDPA-03 1.6 |
| part2/dash.spec.ts | DASH-01 0.9 · DASH-02 1.9 · DASH-03 1.6 · DASH-04 1.3 |
| part2/audit.spec.ts | AUDIT-01 3.4 · AUDIT-02 0.6 · AUDIT-03 2.8 |
| part2/rbac.spec.ts | RBAC-01 0.5 · RBAC-02 1.1 · RBAC-03 8.2 · RBAC-04 2.8 · RBAC-05 6.8 · RBAC-06 2.7 |
| part2/nfr.spec.ts | NFR-01 4.3 · NFR-02 18.1 · NFR-03 2.7 · NFR-04 0.8 |

รวม 51 TC ตรงกับ TEST-PLAN §1 · ทุก BR มี TC ตาม §17 และทุกบั๊กมี TC จับตาม §18 (ดู §4)

## 3. บันทึกการแก้ไขของ B13

หลักที่ใช้: แก้เว็บให้ตรง CONTRACT/BUGS ไม่แก้ test ให้ผ่าน · **B13 ไม่ได้แก้ไฟล์ test เลย** (`e2e/tests/**` ไม่ถูกแก้)

| # | ไฟล์ | ปัญหาที่พบ | การแก้ | ผลยืนยัน |
|---|---|---|---|---|
| 1 | `server/modules/citizen/public/wizard.js` | race ฝั่ง UI ระหว่างสร้างร่างกับอัปโหลด: ขั้น 1 สร้างร่าง (`POST /api/drafts`) แบบ async ถ้าเลือกไฟล์ก่อนได้ `draftId` ไฟล์จะหายไปเงียบ ๆ (`file-item` ไม่ขึ้น) ทำให้ชุดเต็มรอบแรกล้มเป็นบางครั้ง | เก็บ promise ของ `saveDraft()` ที่ยังทำงานอยู่ไว้ใน `savePending` แล้วให้ `onFilesChosen()` รอร่างให้เสร็จก่อนจึงเข้าคิวอัปโหลด (ไม่เปลี่ยน API หรือข้อความใด) | `none` และ `none-again` ผ่าน 51/51 ทั้งรอบ 1 และรอบ 2 |
| 2 | `server/rules/sla.js` (+ ค่าคาดหวังใน `server/rules/rules.test.js`) | B03 รั่วเกินจุด: ใน BUG_MODE=B03 ตัวนับ "วันคงเหลือ" (`businessDaysLeft` → `slaLevel` → การแจ้งเตือน) ก็ไม่ข้ามวันหยุดไปด้วย ทำให้ **TC-NOTI-02 ล้ม** ทั้งที่ไม่อยู่ในตาราง BUGS §2 (ผิดกติกาข้อ 1) | แยกฟังก์ชัน `deadlineHolidays()` ให้ B03 มีผล **เฉพาะ** การคำนวณกำหนดเสร็จ (`dueAt` / `extendDue`) ส่วนวันคงเหลือ ระดับเตือน และการแจ้งเตือนยังใช้ตารางวันหยุดเหมือนเดิม | รอบ 2 B03 ล้มแค่ SLA-01, SLA-02 และ RBAC-04 (ตรงตัวอย่าง BUGS §6) · unit test 22/22 |
| 3 | `scripts/run-bugs.sh` (ใหม่) | – | สคริปต์รันทุก BUG_MODE ตาม BUGS §3 ขั้น 1–6 ตรวจ banner `BUG_MODE` ทุกครั้ง และทำ browser shim ให้อัตโนมัติ | ใช้รันผลทั้งหมดในรายงานนี้ |
| 4 | `scripts/summarize-bugs.cjs` (ใหม่) | – | แปลง Playwright JSON → ตาราง BUGS §4 + ผล triage §5 + ข้อความ assert ที่ล้ม (และเตือนถ้ามี TC ล้มด้วย timeout) | `e2e/reports/bugs/summary.md` |
| 5 | `README.md` §7 | – | เพิ่มวิธีรัน test และ BUG_MODE | – |
| 6 | `e2e/package.json` | ต้องรวม `tests/part2/DEPS.md` | มี `@axe-core/playwright`, `exceljs`, `pdf-parse` ครบแล้ว (B11 เพิ่มไว้) · B13 ตรวจว่าติดตั้งแล้ว และ `tsc --noEmit` ผ่าน | NFR-02 / DASH-03 / DOC-01 ผ่าน |

## 4. ตารางบันทึกผล (BUGS.md §4)

รอบ 2 คือผลสุดท้าย (หลังแก้ข้อ 2) โดยรันชุดเต็ม 51 TC ทุกโหมด

| บั๊ก | TC ที่คาดว่าล้ม (จากตาราง 2) | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผล |
|---|---|---|---|---|---|
| (ปกติ) | – | – | – | – | ✅ 51/51 passed (none · none-again · none-final) |
| B01 | TC-FEE-01 | TC-FEE-01 | – | – | ✅ 50 passed · 1 failed |
| B02 | TC-UPLOAD-01 | TC-UPLOAD-01 | – | – | ✅ 50 passed · 1 failed |
| B03 | TC-SLA-01 · TC-SLA-02 (อาจล้มด้วย TC-SLA-03 · TC-RBAC-04) | TC-SLA-01 · TC-SLA-02 · TC-RBAC-04 | – (RBAC-04 เป็นผลข้างเคียงที่ยอมรับ) | – | ✅ 48 passed · 3 failed |
| B04 | TC-SLA-02 | TC-SLA-02 | – | – | ✅ 50 passed · 1 failed |
| B05 | TC-PAY-01 | TC-PAY-01 | – | – | ✅ 50 passed · 1 failed |
| B06 | TC-RBAC-01 | TC-RBAC-01 | – | – | ✅ 50 passed · 1 failed |
| B07 | TC-RBAC-02 | TC-RBAC-02 | – | – | ✅ 50 passed · 1 failed |
| B08 | TC-QUEUE-02 (ส่วน 3 ต่อกัน ล้มแน่นอน) | TC-QUEUE-02 | – | – | ✅ 50 passed · 1 failed (ล้มทั้งรอบ 1 และรอบ 2) |
| B09 | TC-PDPA-02 | TC-PDPA-02 | – | – | ✅ 50 passed · 1 failed |
| B10 | TC-DASH-02 (อาจล้มด้วย TC-DASH-01 · TC-DASH-03) | TC-DASH-01 · TC-DASH-02 · TC-DASH-03 | – (DASH-01/03 เป็นผลข้างเคียงที่ยอมรับ) | – | ✅ 48 passed · 3 failed |
| B11 | TC-PDPA-03 · TC-AUDIT-01 | TC-PDPA-03 · TC-AUDIT-01 | – | – | ✅ 49 passed · 2 failed |
| B12 | TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | – | ✅ 50 passed · 1 failed |
| B03,B07 | union = SLA-01 · SLA-02 · RBAC-02 (+RBAC-04) | TC-SLA-01 · TC-SLA-02 · TC-RBAC-02 · TC-RBAC-04 | – | – | ✅ 47 passed · 4 failed = union |
| B01,B05,B09 | union = FEE-01 · PAY-01 · PDPA-02 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | – | – | ✅ 48 passed · 3 failed = union |

## 5. Triage (BUGS.md §5/§6) · 12 แถว

ทุกแถวตรงกับกรณีแรกใน §5 คือ "TC ที่ระบุล้ม และที่เหลือผ่าน → test จับบั๊กได้ ตรงแผน"

| บั๊ก | ผลรัน | ข้อความ assert ที่ล้ม (ค่าคาดหวังกับค่าจริง) | อาการตาม §5 | สรุป |
|---|---|---|---|---|
| B01 | 50 passed · 1 failed | TC-FEE-01 `fee-total` expected `฿1,010` received `฿1,000` (SV-03 พื้นที่ 101) | TC ที่ระบุล้ม ที่เหลือผ่าน | ✅ จับได้ตรงจุด |
| B02 | 50 passed · 1 failed | TC-UPLOAD-01 `file-item` expected 1 received 0 (ไฟล์ `size-5242880.pdf` ถูกปฏิเสธ จึงไม่ขึ้นในรายการ) | TC ที่ระบุล้ม ที่เหลือผ่าน | ✅ จับได้ตรงจุด · ล้มด้วยค่า count ไม่ใช่ timeout |
| B03 | 48 passed · 3 failed | TC-SLA-01 แถว c `dueAt` expected `2026-12-08T16:30:00+07:00` received `2026-12-07T16:30:00+07:00` · TC-SLA-02 expected `…12-08T16:30` received `…12-07T16:30` · TC-RBAC-04 expected `2026-12-08T16:30:00+07:00` received `2026-12-04T16:30:00+07:00` (ไม่นับวันหยุด 2 ธ.ค. ที่เพิ่ม) | TC ที่ระบุล้ม + RBAC-04 ซึ่งเป็น "อาจล้มด้วย" | ✅ จับได้ · RBAC-04 เป็นผลข้างเคียงที่ยอมรับ · TC-SLA-03 ผ่าน เพราะ B03 จำกัดให้กระทบเฉพาะกำหนดเสร็จ (§3 ข้อ 2) |
| B04 | 50 passed · 1 failed | TC-SLA-02 `dueAt` หลังส่งแก้ expected `2026-12-08T16:30:00+07:00` received `2026-12-04T16:30:00+07:00` | TC ที่ระบุล้ม ที่เหลือผ่าน | ✅ จับได้ตรงจุด |
| B05 | 50 passed · 1 failed | TC-PAY-01 `POST /api/test/payments/PP-0001/pay` ที่อายุ 15:00 expected 410 received 200 `{"status":"PAID","caseNo":"EG-2569-000031",…}` | TC ที่ระบุล้ม ที่เหลือผ่าน | ✅ จับได้ตรงจุด |
| B06 | 50 passed · 1 failed | TC-RBAC-01 `/citizen/cases/EG-2569-000005` (สมหญิงเปิดของสมชาย) HTTP expected 404 received 200 | TC ที่ระบุล้ม ที่เหลือผ่าน | ✅ จับได้ตรงจุด |
| B07 | 50 passed · 1 failed | TC-RBAC-02 `off.reg2` `POST /api/cases/EG-2569-000014/approve` expected 403 received 200 (ยิง API ตรง ไม่ได้ดูแค่ปุ่ม) | TC ที่ระบุล้ม ที่เหลือผ่าน | ✅ จับได้ตรงจุด · WORKFLOW-01 ผ่าน เพราะถอดแค่การตรวจหัวหน้าของ SV-02 ไม่ได้ถอดการตรวจสิทธิ์อนุมัติทั้งหมด |
| B08 | 50 passed · 1 failed | TC-QUEUE-02 ส่วน 1 (`off.reg1` กับ `off.reg2` กดรับ `…000028` พร้อมกันผ่าน UI): สถานะ `200,200` · จำนวนที่ได้ 200 expected 1 received 2 | TC ที่ระบุล้ม ที่เหลือผ่าน | ✅ จับได้ตรงจุด · ล้มตั้งแต่ส่วน 1 จึงไม่ถึงส่วน 3 (ต่อกัน) · ล้มแน่นอนทุกรอบ เพราะบั๊กข้ามการตรวจผู้ถือ ไม่ได้พึ่ง race (รอบ 1 และรอบ 2 ล้มทั้งคู่) |
| B09 | 50 passed · 1 failed | TC-PDPA-02 JSON ของ `GET /api/officer/queue` expected `not /\d{13}\|\d-\d{4}-\d{5}-\d{2}-\d/` received มีเลขบัตรเต็มใน `idNo` | TC ที่ระบุล้ม ที่เหลือผ่าน | ✅ จับได้ตรงจุด |
| B10 | 48 passed · 3 failed | TC-DASH-02 `kpi-ontime-pct` expected `85.7%` received `23.1%` · TC-DASH-01 expected `–` received `0.0%` · TC-DASH-03 expected `85.7%` received `23.1%` | TC ที่ระบุล้ม + DASH-01/03 ซึ่งเป็น "อาจล้มด้วย" | ✅ จับได้ · ล้มเกิน 1 TC เพราะใช้สูตรเดียวกัน ยอมรับได้ (ตรงตัวอย่าง §6) |
| B11 | 49 passed · 2 failed | TC-PDPA-03 กรอง `UNMASK` แล้ว `audit-count` expected `1` received `0` · TC-AUDIT-01 `audit-count` expected `16` received `15` | TC ที่ระบุล้ม ที่เหลือผ่าน | ✅ จับได้ตรงจุด |
| B12 | 50 passed · 1 failed | TC-WORKFLOW-04 `…000023` (ตีกลับแล้ว 2 ครั้ง) `return-btn` expected count 0 received 1 | TC ที่ระบุล้ม ที่เหลือผ่าน | ✅ จับได้ตรงจุด |

**รวมบั๊ก (BUGS §3 ขั้น 5):** ผลรวมเท่ากับ union ทั้งสองชุด ไม่มีอะไรหายหรือเพิ่มแปลก ๆ
- `B03,B07` ล้ม 4 = {SLA-01, SLA-02, RBAC-04} ∪ {RBAC-02}
- `B01,B05,B09` ล้ม 3 = {FEE-01} ∪ {PAY-01} ∪ {PDPA-02}
- ข้อความ assert เหมือนกับตอนรันบั๊กเดี่ยวทุกตัว

## 6. ประวัติการรัน (สิ่งที่พบระหว่างทาง)

| รอบ | สิ่งที่เกิด | การจัดการ |
|---|---|---|
| รอบ 0 (19:54) | ชุดเต็มรอบแรกล้มเป็นบางครั้งที่ขั้นอัปโหลด (ไฟล์ที่เลือกก่อนสร้างร่างเสร็จหายไป) | แก้ #1 (`wizard.js`) → `none` / `none-again` 51/51 |
| รอบ 1 (image เก่า) | B01, B02, B04–B09, B11, B12 ตรงตาราง · B10 ล้ม DASH-01/02/03 (ยอมรับ) · **B03 ล้ม TC-NOTI-02 เกินตาราง** | หยุด batch · แก้ #2 (`sla.js`) · rebuild image (20:25) แล้วรันใหม่ทุกโหมด |
| รอบ 2 (image 20:25) | `none`, `none-again`, B01–B07 รันวันที่ 21 พ.ย. (20:27–20:43) · เครื่อง/Docker รีสตาร์ตระหว่าง B08 · รันต่อ B08–B12, `B03,B07`, `B01,B05,B09`, `none-final` วันที่ 22 พ.ย. (08:31–08:53) บน image เดิม (ตรวจแล้วว่าไม่มีไฟล์ซอร์สเปลี่ยนหลัง build) | ผลทุกโหมดตรงตาราง (§4) |

## 7. หลักฐาน

| ไฟล์ | เนื้อหา |
|---|---|
| `e2e/reports/bugs/<โหมด>.json` | Playwright JSON ของแต่ละโหมด (`none`, `none-again`, `B01`…`B12`, `B03+B07`, `B01+B05+B09`, `none-final`) |
| `e2e/reports/bugs/<โหมด>.log` | log ของ Playwright line reporter |
| `e2e/reports/bugs/summary.md` | ตาราง §4 กับข้อความ assert ทุกตัวที่ล้ม (สร้างจาก `scripts/summarize-bugs.cjs`) |
| `/tmp/b13-test-results/<โหมด>/` | trace และ screenshot ของ TC ที่ล้ม (`trace: retain-on-failure`) |

หลังรันเสร็จ เว็บกลับมาอยู่ในโหมดถูกต้อง: `docker compose logs web` แสดง `BUG_MODE : (none — correct app)` และ `/api/health` ตอบ `{"status":"ok"}`
