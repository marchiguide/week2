# BUG-HUNT · e-Service เทศบาลในฝัน · พิสูจน์ว่า test จับบั๊กได้ (BUG_MODE B01–B12)

> ทำตาม `egov-brief/BUGS.md` §3 · รันวันที่ 22 พ.ย. 2569 ใน container `multi-account` ที่ `/workspace/plans/egov-eservice/app` (ตรงกับสำเนา `./app` ในโฟลเดอร์นี้)
> เว็บ: image `egov-eservice-web:latest` (build หลังเปลี่ยนชื่อเป็น "เทศบาลในฝัน") · `TEST_MODE=1` · Playwright 1.65.1 · `workers 1` · `retries 0`
> คำสั่ง: `NO_BUILD=1 app/scripts/run-bugs.sh B01 B02 … B12 none` · ทุกรอบ restart เว็บแล้วตรวจ banner ตอนเริ่มว่า `BUG_MODE` ตรงกับที่ตั้ง
> ตัดสินผลด้วยสคริปต์ตรวจแยกที่อ่าน JSON ของแต่ละรอบเทียบกับ BUGS.md §2 ตรง ๆ (ไม่ใช้สรุปของ B13)

## สรุป

**จับได้ 12/12 บั๊ก** · ทุก "TC ที่ต้องล้ม" ล้มจริง · ไม่มี TC นอกตารางล้ม · TC ที่ล้มเกินมีแค่ใน B03 และ B10 และอยู่ในช่อง "อาจล้มด้วย" ทั้งหมด · ปิดบั๊กแล้วกลับมาผ่าน 51/51

รอบนี้ไม่ต้องแก้เว็บหรือ test เพราะทุกบั๊กจับได้ตั้งแต่รอบแรก ส่วนที่เคยแก้ไปแล้วในขั้นรวมระบบ (B13) ดูท้ายไฟล์

## ตารางบันทึกผล (BUGS.md §4)

| บั๊ก | TC ที่คาดว่าล้ม (จากตาราง 2) | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผล |
|---|---|---|---|---|---|
| (ปกติ) | – | – | – | – | ✅ 51/51 passed (`none` ท้ายชุด หลังรันครบ 12 บั๊ก) |
| B01 | TC-FEE-01 | TC-FEE-01 | – | – | ✅ 50 passed · 1 failed |
| B02 | TC-UPLOAD-01 | TC-UPLOAD-01 | – | – | ✅ 50 passed · 1 failed |
| B03 | TC-SLA-01 · TC-SLA-02 (อาจล้มด้วย TC-SLA-03 · TC-RBAC-04) | TC-SLA-01 · TC-SLA-02 · TC-RBAC-04 | – (TC-RBAC-04 อยู่ในช่องอาจล้มด้วย) | – | ✅ 48 passed · 3 failed |
| B04 | TC-SLA-02 | TC-SLA-02 | – | – | ✅ 50 passed · 1 failed |
| B05 | TC-PAY-01 | TC-PAY-01 | – | – | ✅ 50 passed · 1 failed |
| B06 | TC-RBAC-01 | TC-RBAC-01 | – | – | ✅ 50 passed · 1 failed |
| B07 | TC-RBAC-02 | TC-RBAC-02 | – | – | ✅ 50 passed · 1 failed |
| B08 | TC-QUEUE-02 (ส่วน 3 ต่อกัน ล้มแน่นอน) | TC-QUEUE-02 | – | – | ✅ 50 passed · 1 failed |
| B09 | TC-PDPA-02 | TC-PDPA-02 | – | – | ✅ 50 passed · 1 failed |
| B10 | TC-DASH-02 (อาจล้มด้วย TC-DASH-01 · TC-DASH-03) | TC-DASH-01 · TC-DASH-02 · TC-DASH-03 | – (DASH-01/03 อยู่ในช่องอาจล้มด้วย) | – | ✅ 48 passed · 3 failed |
| B11 | TC-PDPA-03 · TC-AUDIT-01 | TC-PDPA-03 · TC-AUDIT-01 | – | – | ✅ 49 passed · 2 failed |
| B12 | TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | – | ✅ 50 passed · 1 failed |

## Triage (BUGS.md §5 · รูปแบบ §6)

| บั๊ก | ผลรัน (ข้อความ assert ที่ล้ม) | สรุป |
|---|---|---|
| B01 | 50 passed · 1 failed: TC-FEE-01 `fee-total` expected `฿1,010` received `฿1,000` (SV-03 พื้นที่ 101) | ✅ จับได้ตรงจุด |
| B02 | 50 passed · 1 failed: TC-UPLOAD-01 `file-item` expected `1` received `0` (ไฟล์ 5,242,880 ไบต์ถูกปฏิเสธ จึงไม่ขึ้นในรายการ) | ✅ จับได้ตรงจุด |
| B03 | 48 passed · 3 failed: TC-SLA-01 `dueAt` expected `2026-12-08T16:30:00+07:00` received `2026-12-07T16:30:00+07:00` · TC-SLA-02 expected `…12-08T16:30` received `…12-07T16:30` · TC-RBAC-04 expected `2026-12-08T16:30:00+07:00` received `2026-12-04T16:30:00+07:00` | ✅ จับได้ · TC-RBAC-04 ล้มด้วยเป็นผลข้างเคียงที่ยอมรับ (วันหยุด 2 ธ.ค. ที่เพิ่มไม่ถูกนับ) · TC-SLA-03 ผ่าน (อยู่ในช่องอาจล้มด้วย ไม่นับเป็นผิด) |
| B04 | 50 passed · 1 failed: TC-SLA-02 `dueAt` หลังส่งแก้ expected `2026-12-08T16:30:00+07:00` received `2026-12-04T16:30:00+07:00` | ✅ จับได้ตรงจุด (ไม่หยุดนับระหว่างรอแก้ไข) |
| B05 | 50 passed · 1 failed: TC-PAY-01 จ่าย QR อายุ 15:00 expected `410` received `200` | ✅ จับได้ตรงจุด |
| B06 | 50 passed · 1 failed: TC-RBAC-01 สมหญิงเปิด `EG-2569-000005` ของสมชาย expected `404` received `200` | ✅ จับได้ตรงจุด (IDOR) |
| B07 | 50 passed · 1 failed: TC-RBAC-02 `off.reg2` `POST /api/cases/EG-2569-000014/approve` expected `403` received `200` | ✅ จับได้ตรงจุด · test ยิง API ตรง ไม่ได้ดูแค่ว่าปุ่มหาย (ไม่ใช่กรณีผ่านหลอกใน §6) · TC-WORKFLOW-01 ผ่าน |
| B08 | 50 passed · 1 failed: TC-QUEUE-02 รับเรื่องซ้อน expected length `1` received length `2` | ✅ จับได้ตรงจุด · ล้มเพราะข้ามการตรวจผู้ถือ ไม่พึ่ง race |
| B09 | 50 passed · 1 failed: TC-PDPA-02 JSON ของ `GET /api/officer/queue` ต้องไม่ match `/\d{13}\|\d-\d{4}-\d{5}-\d{2}-\d/` แต่พบเลขบัตรเต็ม | ✅ จับได้ตรงจุด |
| B10 | 48 passed · 3 failed: TC-DASH-02 `kpi-ontime-pct` expected `85.7%` received `23.1%` · TC-DASH-01 expected `–` received `0.0%` · TC-DASH-03 expected `85.7%` received `23.1%` | ✅ จับได้ ล้มเกิน 2 TC เพราะใช้สูตรเดียวกัน ยอมรับได้ (ตรงตัวอย่าง §6) |
| B11 | 49 passed · 2 failed: TC-PDPA-03 กรอง `UNMASK` แล้ว `audit-count` expected `1` received `0` · TC-AUDIT-01 `audit-count` expected `16` received `15` | ✅ จับได้ตรงจุด |
| B12 | 50 passed · 1 failed: TC-WORKFLOW-04 `return-btn` ของคำขอที่ตีกลับครบ 2 ครั้ง expected count `0` received `1` | ✅ จับได้ตรงจุด |

**BUGS §3 ขั้น 4 (ล้มเพราะค่า ไม่ใช่ timeout):** ทุก TC ที่ล้มมีสถานะ `failed` และข้อความบอกค่าที่คาดหวังกับค่าจริง ไม่มี `timedOut` ไม่มี "หา element ไม่เจอ" · บางข้อความมีบรรทัด `Timeout 10000ms` เพราะเป็น assertion แบบรอค่า (`toHaveText`) ที่รอแล้วค่ายังไม่ตรง ไม่ใช่หน้าเว็บค้าง

## ข้อสังเกต

- **ขั้น 5 (รวมบั๊ก) ไม่ได้รันในรอบนี้** เพราะโจทย์ขั้น 5 ของ PROMPTS ขอแค่ B01–B12 ทีละตัว · ผลของ `B03,B07` (ล้ม 4 = union) และ `B01,B05,B09` (ล้ม 3 = union) จากรอบ B13 อยู่ใน `app/app/TEST-REPORT.md` §4 ซึ่งรันบน image ก่อนเปลี่ยนชื่อ
- **สิ่งที่เคยแก้ก่อนหน้า (ขั้นรวมระบบ B13) เพื่อให้ผลตรงตาราง** ดูรายละเอียดใน `app/app/TEST-REPORT.md` §3
  - เว็บผิด: `server/rules/sla.js` บั๊ก B03 เคยรั่วไปที่การนับวันคงเหลือ/ระดับเตือน ทำให้ TC-NOTI-02 ล้มนอกตาราง (ผิดกติกา §1 ข้อ 1) → แยกให้ B03 กระทบเฉพาะการคำนวณกำหนดเสร็จ
  - เว็บผิด: `server/modules/citizen/public/wizard.js` race ระหว่างสร้างร่างกับอัปโหลด ทำให้ชุดปกติล้มบางครั้ง
  - ไม่มีการแก้ไฟล์ test หรือค่าที่คาดหวัง
- **คำถามถึง TA (ไม่ได้แก้เอง):** BUGS.md §2 บอกว่า B03 อาจทำให้ TC-SLA-03 ล้ม เพราะ "ฟังก์ชันวันทำการตัวเดียวกันใช้นับวันคงเหลือ" แต่ถ้าทำแบบนั้นในเว็บนี้ TC-NOTI-02 จะล้มด้วยซึ่งไม่อยู่ในตาราง จึงจำกัดให้ B03 กระทบเฉพาะกำหนดเสร็จ ขอยืนยันว่าแบบนี้ถูกตามเจตนา หรือควรเพิ่ม TC-NOTI-02 ในช่อง "อาจล้มด้วย" ของ B03

## หลักฐาน

| ไฟล์ | เนื้อหา |
|---|---|
| `app/app/e2e/reports/bugs/B01.json` … `B12.json` · `none.json` | Playwright JSON ของแต่ละรอบ (รอบนี้) |
| `app/app/e2e/reports/bugs/*.log` | log ของแต่ละรอบ |
| `app/app/e2e/reports/bugs/summary.md` | สรุปจาก `scripts/summarize-bugs.cjs` |
| `app/app/scripts/run-bugs.sh` | สคริปต์รันทุกโหมด (restart เว็บ + ตรวจ banner + playwright) |
