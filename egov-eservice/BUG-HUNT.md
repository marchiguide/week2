# BUG-HUNT · e-Service เทศบาลในฝัน · พิสูจน์ว่า test จับบั๊กได้ (BUG_MODE B01–B12)

> ทำตาม `egov-brief/BUGS.md` §3 · รันใน container `multi-account` ที่ `/workspace/plans/egov-eservice/app` (ตรงกับสำเนา `./app` ในโฟลเดอร์นี้) · `TEST_MODE=1` · Playwright 1.65.1 · `workers 1` · `retries 0`
> รอบหลัก (22 พ.ย. 2569 ราว 09:30–10:06): `NO_BUILD=1 app/scripts/run-bugs.sh B01 B02 … B12 none` บน image หลังเปลี่ยนชื่อเป็น "เทศบาลในฝัน"
> รอบแก้หลังตรวจทาน (22 พ.ย. 2569 22:01–22:13): จำกัด B07 ให้กระทบเฉพาะ SV-02 (ดูข้อสังเกต) แล้ว build ใหม่ และรัน `none` `none-again` `B07` `B03,B07` `B08` `none-final` · แถว B07 B08 และ (ปกติ) ในตารางเป็นผลรอบนี้
> ทุกรอบ restart เว็บแล้วตรวจ banner ตอนเริ่มว่า `BUG_MODE` ตรงกับที่ตั้ง · ตัดสินผลด้วยสคริปต์ตรวจแยกที่อ่าน JSON ของแต่ละรอบเทียบกับ BUGS.md §2 ตรง ๆ (ไม่ใช้สรุปของ B13)

## สรุป

**จับได้ 12/12 บั๊ก** · ทุก "TC ที่ต้องล้ม" ล้มจริง · ไม่มี TC นอกตารางล้ม · TC ที่ล้มเกินมีแค่ใน B03 และ B10 และอยู่ในช่อง "อาจล้มด้วย" ทั้งหมด · ปิดบั๊กแล้วกลับมาผ่าน 51/51 (`none` → `none-again` ต่อกันบนเว็บตัวเดียว และ `none-final`)

ไม่มีบั๊กไหนที่ test ผ่านหลอก จึงไม่ได้แก้ test · แก้เว็บ 1 จุดหลังตรวจทานโค้ด: บั๊ก B07 กว้างเกินจุดที่ BUGS.md กำหนด (ดูข้อสังเกต)

## ตารางบันทึกผล (BUGS.md §4)

| บั๊ก | TC ที่คาดว่าล้ม (จากตาราง 2) | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผล |
|---|---|---|---|---|---|
| (ปกติ) | – | – | – | – | ✅ 51/51 passed (`none` 22:01 · `none-again` 22:03 ต่อกันโดยไม่ restart · `none-final` 22:12) |
| B01 | TC-FEE-01 | TC-FEE-01 | – | – | ✅ 50 passed · 1 failed |
| B02 | TC-UPLOAD-01 | TC-UPLOAD-01 | – | – | ✅ 50 passed · 1 failed |
| B03 | TC-SLA-01 · TC-SLA-02 (อาจล้มด้วย TC-SLA-03 · TC-RBAC-04) | TC-SLA-01 · TC-SLA-02 · TC-RBAC-04 | – (TC-RBAC-04 อยู่ในช่องอาจล้มด้วย) | – | ✅ 48 passed · 3 failed |
| B04 | TC-SLA-02 | TC-SLA-02 | – | – | ✅ 50 passed · 1 failed |
| B05 | TC-PAY-01 | TC-PAY-01 | – | – | ✅ 50 passed · 1 failed |
| B06 | TC-RBAC-01 | TC-RBAC-01 | – | – | ✅ 50 passed · 1 failed |
| B07 | TC-RBAC-02 | TC-RBAC-02 | – | – | ✅ 50 passed · 1 failed (หลังจำกัดเฉพาะ SV-02) |
| B08 | TC-QUEUE-02 (ส่วน 3 ต่อกัน ล้มแน่นอน) | TC-QUEUE-02 | – | – | ✅ 50 passed · 1 failed |
| B09 | TC-PDPA-02 | TC-PDPA-02 | – | – | ✅ 50 passed · 1 failed |
| B10 | TC-DASH-02 (อาจล้มด้วย TC-DASH-01 · TC-DASH-03) | TC-DASH-01 · TC-DASH-02 · TC-DASH-03 | – (DASH-01/03 อยู่ในช่องอาจล้มด้วย) | – | ✅ 48 passed · 3 failed |
| B11 | TC-PDPA-03 · TC-AUDIT-01 | TC-PDPA-03 · TC-AUDIT-01 | – | – | ✅ 49 passed · 2 failed |
| B12 | TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | – | ✅ 50 passed · 1 failed |
| B03,B07 (รวม · BUGS §3 ขั้น 5) | union = TC-SLA-01 · TC-SLA-02 · TC-RBAC-02 (+TC-RBAC-04) | TC-SLA-01 · TC-SLA-02 · TC-RBAC-02 · TC-RBAC-04 | – | – | ✅ 47 passed · 4 failed = union (รันซ้ำหลังแก้ B07) |

## Triage (BUGS.md §5 · รูปแบบ §6)

| บั๊ก | ผลรัน (ข้อความ assert ที่ล้ม) | สรุป |
|---|---|---|
| B01 | 50 passed · 1 failed: TC-FEE-01 `fee-total` expected `฿1,010` received `฿1,000` (SV-03 พื้นที่ 101) | ✅ จับได้ตรงจุด |
| B02 | 50 passed · 1 failed: TC-UPLOAD-01 `file-item` expected `1` received `0` (ไฟล์ 5,242,880 ไบต์ถูกปฏิเสธ จึงไม่ขึ้นในรายการ) | ✅ จับได้ตรงจุด |
| B03 | 48 passed · 3 failed: TC-SLA-01 `dueAt` expected `2026-12-08T16:30:00+07:00` received `2026-12-07T16:30:00+07:00` · TC-SLA-02 expected `…12-08T16:30` received `…12-07T16:30` · TC-RBAC-04 expected `2026-12-08T16:30:00+07:00` received `2026-12-04T16:30:00+07:00` | ✅ จับได้ · TC-RBAC-04 ล้มด้วยเป็นผลข้างเคียงที่ยอมรับ (วันหยุด 2 ธ.ค. ที่เพิ่มไม่ถูกนับ) · TC-SLA-03 ผ่าน (อยู่ในช่องอาจล้มด้วย ไม่นับเป็นผิด) |
| B04 | 50 passed · 1 failed: TC-SLA-02 `dueAt` หลังส่งแก้ expected `2026-12-08T16:30:00+07:00` received `2026-12-04T16:30:00+07:00` | ✅ จับได้ตรงจุด (ไม่หยุดนับระหว่างรอแก้ไข) |
| B05 | 50 passed · 1 failed: TC-PAY-01 จ่าย QR อายุ 15:00 expected `410` received `200` | ✅ จับได้ตรงจุด |
| B06 | 50 passed · 1 failed: TC-RBAC-01 สมหญิงเปิด `EG-2569-000005` ของสมชาย expected `404` received `200` | ✅ จับได้ตรงจุด (IDOR) |
| B07 | 50 passed · 1 failed: TC-RBAC-02 `off.reg2` `POST /api/cases/EG-2569-000014/approve` expected `403` received `200` | ✅ จับได้ตรงจุด · test ยิง API ตรง ไม่ได้ดูแค่ว่าปุ่มหาย (ไม่ใช่กรณีผ่านหลอกใน §6) · หลังแก้ บั๊กกระทบเฉพาะ SV-02: API ยืนยันว่าเจ้าหน้าที่อนุมัติ SV-03 `…000010` ขณะเปิด B07 ยังได้ `403` · TC-WORKFLOW-01 ผ่าน |
| B08 | 50 passed · 1 failed: TC-QUEUE-02 ส่วน 1 (กดรับ `…000028` พร้อมกันผ่าน UI) expected length `1` received length `2` | ✅ จับได้ตรงจุด · TC ล้มตั้งแต่ส่วน 1 จึงไม่ถึงส่วน 3 (ต่อกัน) ในชุด Playwright → ยืนยันส่วน 3 ด้วย API แยก: `off.reg1` claim `…000029` → `200` แล้ว `off.reg2` claim ต่อกัน → `200` และผู้ถือกลายเป็น `off.reg2` (เว็บถูกต้อง: `409 ALREADY_CLAIMED` ผู้ถือยัง `off.reg1`) · ล้มทุกรอบที่รัน ไม่พึ่ง race |
| B09 | 50 passed · 1 failed: TC-PDPA-02 JSON ของ `GET /api/officer/queue` ต้องไม่ match `/\d{13}\|\d-\d{4}-\d{5}-\d{2}-\d/` แต่พบเลขบัตรเต็ม | ✅ จับได้ตรงจุด |
| B10 | 48 passed · 3 failed: TC-DASH-02 `kpi-ontime-pct` expected `85.7%` received `23.1%` · TC-DASH-01 expected `–` received `0.0%` · TC-DASH-03 expected `85.7%` received `23.1%` | ✅ จับได้ ล้มเกิน 2 TC เพราะใช้สูตรเดียวกัน ยอมรับได้ (ตรงตัวอย่าง §6) |
| B11 | 49 passed · 2 failed: TC-PDPA-03 กรอง `UNMASK` แล้ว `audit-count` expected `1` received `0` · TC-AUDIT-01 `audit-count` expected `16` received `15` | ✅ จับได้ตรงจุด |
| B12 | 50 passed · 1 failed: TC-WORKFLOW-04 ส่วน A `…000020` (SV-01 ที่ `off.reg1` ตีกลับครบ 2 ครั้งระหว่างทดสอบ) `return-btn` expected count `0` received `1` · TC หยุดที่ assertion นี้ จึงไม่ถึงการยิง API return ครั้งที่ 3 และส่วน B `…000023` | ✅ จับได้ตรงจุด |

**BUGS §3 ขั้น 4 (ล้มเพราะค่า ไม่ใช่ timeout):** ทุก TC ที่ล้มมีสถานะ `failed` และข้อความบอกค่าที่คาดหวังกับค่าจริง ไม่มี `timedOut` ไม่มี "หา element ไม่เจอ" · บางข้อความมีบรรทัด `Timeout 10000ms` เพราะเป็น assertion แบบรอค่า (`toHaveText`) ที่รอแล้วค่ายังไม่ตรง ไม่ใช่หน้าเว็บค้าง

## ข้อสังเกต

- **แก้เว็บหลังตรวจทาน: B07 กว้างเกินจุด (เว็บผิด · BUGS §1 ข้อ 1 · §2 B07 · BR-21)** · สาขา `bug('B07')` ใน `server/modules/officer/service.js` (`checkDecider`) เคยข้ามการตรวจหัวหน้าให้ทุกบริการที่หัวหน้าอนุมัติ (SV-02 และ SV-03) ทั้งที่ BUGS.md กำหนดให้กระทบเฉพาะ SV-02 · ชุด TC ไม่จับได้เพราะไม่มี TC ใดยิงอนุมัติ SV-03 ด้วยเจ้าหน้าที่ขณะเปิด B07 · แก้โดยเพิ่มเงื่อนไข `c.service_id === 'SV-02'` · ผลหลังแก้: `B07` ยังล้มแค่ TC-RBAC-02 · `B03,B07` = union · `none`/`none-again`/`none-final` 51/51 · API: SV-03 ยัง `403`
- **คู่หลักฐาน `none` / `none-again`:** ก่อนหน้านี้ `none.json` ถูกเขียนทับโดยรอบอื่น ทำให้ไม่ได้มาจากรอบเดียวกับ `none-again.json` · รันคู่ใหม่ต่อกันบนเว็บตัวเดียว (22:01 → 22:03) แล้ว
- **รวมบั๊ก (BUGS §3 ขั้น 5):** `B03,B07` รันซ้ำหลังแก้ B07 แล้ว = union · `B01,B05,B09` (ล้ม 3 = union) เป็นผลจากรอบ B13 (ไม่ได้รันซ้ำ เพราะไม่เกี่ยวกับจุดที่แก้)
- **สิ่งที่เคยแก้ก่อนหน้า (ขั้นรวมระบบ B13)** ดูรายละเอียดใน `app/app/TEST-REPORT.md` §3
  - TC-NOTI-02 ล้มนอกตารางเมื่อเปิด B03 · เว็บผิด: `server/rules/sla.js` บั๊ก B03 รั่วไปที่การนับวันคงเหลือ/ระดับเตือน → แยกให้ B03 กระทบเฉพาะการคำนวณกำหนดเสร็จ
  - TC-NFR-01 ล้ม (BUG_MODE ว่าง) · เว็บผิด: `server/modules/citizen/public/wizard.js` race ระหว่างสร้างร่างกับอัปโหลด → รอสร้างร่างเสร็จก่อนอัปโหลด
  - ไม่มีการแก้ไฟล์ test หรือค่าที่คาดหวัง
- **คำถามถึง TA (ไม่ได้แก้เอง):** BUGS.md §2 บอกว่า B03 อาจทำให้ TC-SLA-03 ล้ม เพราะ "ฟังก์ชันวันทำการตัวเดียวกันใช้นับวันคงเหลือ" แต่ถ้าทำแบบนั้นในเว็บนี้ TC-NOTI-02 จะล้มด้วยซึ่งไม่อยู่ในตาราง จึงจำกัดให้ B03 กระทบเฉพาะกำหนดเสร็จ ขอยืนยันว่าแบบนี้ถูกตามเจตนา หรือควรเพิ่ม TC-NOTI-02 ในช่อง "อาจล้มด้วย" ของ B03

## หลักฐาน

| ไฟล์ | เนื้อหา |
|---|---|
| `app/app/e2e/reports/bugs/B01.json` … `B12.json` | Playwright JSON ของแต่ละบั๊ก (B07 · B08 เป็นรอบหลังแก้ 22:04 · 22:10) |
| `app/app/e2e/reports/bugs/none.json` · `none-again.json` · `none-final.json` | BUG_MODE ว่าง: คู่รันต่อกัน 22:01 · 22:03 และหลังรันทุกโหมด 22:12 |
| `app/app/e2e/reports/bugs/B03+B07.json` · `B01+B05+B09.json` | รวมบั๊ก (BUGS §3 ขั้น 5) |
| `app/app/e2e/reports/bugs/api-evidence.md` | ยิง API ตรง: ขอบเขต B07 (SV-03 ยัง 403) และ TC-QUEUE-02 ส่วน 3 ภายใต้ B08 เทียบเว็บถูกต้อง |
| `app/app/e2e/reports/bugs/*.log` | log ของแต่ละรอบ |
| `app/app/e2e/reports/bugs/summary.md` | สรุปจาก `scripts/summarize-bugs.cjs` |
| `app/app/scripts/run-bugs.sh` | สคริปต์รันทุกโหมด (restart เว็บ + ตรวจ banner + playwright) |
