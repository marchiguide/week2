# API evidence (นอกชุด Playwright) · 2026-11-22 22:14 +0700

สคริปต์ยิง API ตรงกับเว็บใน container (TEST_MODE=1) เพื่อยืนยันขอบเขตของ B07 และส่วน 3 ของ TC-QUEUE-02 (รับเรื่องต่อกัน) ซึ่งชุด Playwright ไม่ได้ไปถึงเมื่อเปิด B08 (TC ล้มตั้งแต่ส่วน 1)

## BUG_MODE=B07,B08
| check | HTTP | code / owner / status |
|---|---|---|
| B07 scope · off.reg1 approve EG-2569-000010 (SV-03, IN_REVIEW) | 403 | FORBIDDEN |
| B07 · off.reg2 approve EG-2569-000014 (SV-02) | 200 | APPROVED |
| B08 part 3 · off.reg1 claim EG-2569-000029 | 200 | off.reg1 |
| B08 part 3 · off.reg2 claim EG-2569-000029 (sequential) | 200 | off.reg2 |
| B08 part 3 · owner after both | 200 | off.reg2 |

## BUG_MODE ว่าง (เว็บถูกต้อง · ใช้เทียบ)
| check | HTTP | code / owner / status |
|---|---|---|
| B07 scope · off.reg1 approve EG-2569-000010 (SV-03, IN_REVIEW) | 403 | FORBIDDEN |
| B07 · off.reg2 approve EG-2569-000014 (SV-02) | 403 | FORBIDDEN |
| B08 part 3 · off.reg1 claim EG-2569-000029 | 200 | off.reg1 |
| B08 part 3 · off.reg2 claim EG-2569-000029 (sequential) | 409 | ALREADY_CLAIMED |
| B08 part 3 · owner after both | 200 | off.reg1 |
