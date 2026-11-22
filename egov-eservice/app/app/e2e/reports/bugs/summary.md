| บั๊ก | TC ที่คาดว่าล้ม | TC ที่ล้มจริง | TC ล้มเกินที่คาด | TC ที่ควรล้มแต่ผ่าน | ผ่าน/ทั้งหมด | ผล |
|---|---|---|---|---|---|---|
| none | – | – | – | – | 51/51 | ✅ 51/51 passed |
| none-again | – | – | – | – | 51/51 | ✅ 51/51 passed |
| B01 | TC-FEE-01 | TC-FEE-01 | – | – | 50/51 | ✅ จับได้ตรงจุด |
| B02 | TC-UPLOAD-01 | TC-UPLOAD-01 | – | – | 50/51 | ✅ จับได้ตรงจุด |
| B03 | TC-SLA-01 · TC-SLA-02 (อาจล้ม: TC-SLA-03 · TC-RBAC-04) | TC-SLA-01 · TC-SLA-02 · TC-RBAC-04 | – | – | 48/51 | ✅ จับได้ตรงจุด (+ผลข้างเคียงที่ยอมรับ) |
| B04 | TC-SLA-02 | TC-SLA-02 | – | – | 50/51 | ✅ จับได้ตรงจุด |
| B05 | TC-PAY-01 | TC-PAY-01 | – | – | 50/51 | ✅ จับได้ตรงจุด |
| B06 | TC-RBAC-01 | TC-RBAC-01 | – | – | 50/51 | ✅ จับได้ตรงจุด |
| B07 | TC-RBAC-02 (อาจล้ม: TC-WORKFLOW-01) | TC-RBAC-02 | – | – | 50/51 | ✅ จับได้ตรงจุด |
| B08 | TC-QUEUE-02 | TC-QUEUE-02 | – | – | 50/51 | ✅ จับได้ตรงจุด |
| B09 | TC-PDPA-02 | TC-PDPA-02 | – | – | 50/51 | ✅ จับได้ตรงจุด |
| B10 | TC-DASH-02 (อาจล้ม: TC-DASH-01 · TC-DASH-03) | TC-DASH-01 · TC-DASH-02 · TC-DASH-03 | – | – | 48/51 | ✅ จับได้ตรงจุด (+ผลข้างเคียงที่ยอมรับ) |
| B11 | TC-PDPA-03 · TC-AUDIT-01 | TC-AUDIT-01 · TC-PDPA-03 | – | – | 49/51 | ✅ จับได้ตรงจุด |
| B12 | TC-WORKFLOW-04 | TC-WORKFLOW-04 | – | – | 50/51 | ✅ จับได้ตรงจุด |
| B03,B07 | TC-SLA-01 · TC-SLA-02 · TC-RBAC-02 (อาจล้ม: TC-SLA-03 · TC-RBAC-04 · TC-WORKFLOW-01) | TC-SLA-01 · TC-SLA-02 · TC-RBAC-02 · TC-RBAC-04 | – | – | 47/51 | ✅ จับได้ตรงจุด (+ผลข้างเคียงที่ยอมรับ) |
| B01,B05,B09 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | TC-FEE-01 · TC-PAY-01 · TC-PDPA-02 | – | – | 48/51 | ✅ จับได้ตรงจุด |
| none-final | – | – | – | – | 51/51 | ✅ 51/51 passed |
| none-after-rename | – | – | – | – | 51/51 | ✅ 51/51 passed |

### ข้อความที่ล้ม (BUGS §3 ขั้น 4)

| โหมด | TC | สถานะ | ข้อความ assert |
|---|---|---|---|
| B01 | TC-FEE-01 | failed | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('fee-total') · Expected: "฿1,010" · Received: "฿1,000" |
| B02 | TC-UPLOAD-01 | failed | Error: expect(locator).toHaveCount(expected) failed · Locator:  getByTestId('file-item') · Expected: 1 · Received: 0 |
| B03 | TC-SLA-01 | failed | Error: แถว c dueAt · expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-07T16:30:00+07:00" |
| B03 | TC-SLA-02 | failed | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-07T16:30:00+07:00" · 65 \|     await expect(c.page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ'); |
| B03 | TC-RBAC-04 | failed | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-04T16:30:00+07:00" |
| B04 | TC-SLA-02 | failed | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-04T16:30:00+07:00" · 65 \|     await expect(c.page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ'); |
| B05 | TC-PAY-01 | failed | Error: http://localhost:8080/api/test/payments/PP-0001/pay → {"status":"PAID","caseNo":"EG-2569-000031","receiptNo":"RC-2569-000031","duplicate":false} · expect(received).toBe(expected) // Object.is equality · Expected: 410 · Received: 200 |
| B06 | TC-RBAC-01 | failed | Error: /citizen/cases/EG-2569-000005 HTTP status · expect(received).toBe(expected) // Object.is equality · Expected: 404 · Received: 200 |
| B07 | TC-RBAC-02 | failed | Error: http://localhost:8080/api/cases/EG-2569-000014/approve HTTP status · expect(received).toBe(expected) // Object.is equality · Expected: 403 · Received: 200 |
| B08 | TC-QUEUE-02 | failed | Error: statuses 200,200 · expect(received).toHaveLength(expected) · Expected length: 1 · Received length: 2 |
| B09 | TC-PDPA-02 | failed | Error: expect(received).not.toMatch(expected) · Expected pattern: not /\d{13}\|\d-\d{4}-\d{5}-\d{2}-\d/ · Received string:      "{\"items\":[{\"caseNo\":\"EG-2569-000020\",\"serviceId\":\"SV-01\",\"applicantName\":\"สมชาย ใจดี\",\"idMasked\":\"X-XXXX-XXXXX-45-6\",\"status\":\"IN_REVIEW\",\"step\":null,\"dept\":\"registry\",\"owner\":\"off.reg1\",\"dueAt\":\"2026-11-30T16:30:00+07:00\",\"slaLevel\" |
| B10 | TC-DASH-01 | failed | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('kpi-ontime-pct') · Expected: "–" · Received: "0.0%" |
| B10 | TC-DASH-02 | failed | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('kpi-ontime-pct') · Expected: "85.7%" · Received: "23.1%" |
| B10 | TC-DASH-03 | failed | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('kpi-ontime-pct') · Expected: "85.7%" · Received: "23.1%" |
| B11 | TC-AUDIT-01 | failed | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('audit-count') · Expected: "16" · Received: "15" |
| B11 | TC-PDPA-03 | failed | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('audit-count') · Expected: "1" · Received: "0" |
| B12 | TC-WORKFLOW-04 | failed | Error: expect(locator).toHaveCount(expected) failed · Locator:  getByTestId('return-btn') · Expected: 0 · Received: 1 |
| B03,B07 | TC-SLA-01 | failed | Error: แถว c dueAt · expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-07T16:30:00+07:00" |
| B03,B07 | TC-SLA-02 | failed | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-07T16:30:00+07:00" · 65 \|     await expect(c.page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ'); |
| B03,B07 | TC-RBAC-02 | failed | Error: http://localhost:8080/api/cases/EG-2569-000014/approve HTTP status · expect(received).toBe(expected) // Object.is equality · Expected: 403 · Received: 200 |
| B03,B07 | TC-RBAC-04 | failed | Error: expect(received).toBe(expected) // Object.is equality · Expected: "2026-12-08T16:30:00+07:00" · Received: "2026-12-04T16:30:00+07:00" |
| B01,B05,B09 | TC-FEE-01 | failed | Error: expect(locator).toHaveText(expected) failed · Locator:  getByTestId('fee-total') · Expected: "฿1,010" · Received: "฿1,000" |
| B01,B05,B09 | TC-PAY-01 | failed | Error: http://localhost:8080/api/test/payments/PP-0001/pay → {"status":"PAID","caseNo":"EG-2569-000031","receiptNo":"RC-2569-000031","duplicate":false} · expect(received).toBe(expected) // Object.is equality · Expected: 410 · Received: 200 |
| B01,B05,B09 | TC-PDPA-02 | failed | Error: expect(received).not.toMatch(expected) · Expected pattern: not /\d{13}\|\d-\d{4}-\d{5}-\d{2}-\d/ · Received string:      "{\"items\":[{\"caseNo\":\"EG-2569-000020\",\"serviceId\":\"SV-01\",\"applicantName\":\"สมชาย ใจดี\",\"idMasked\":\"X-XXXX-XXXXX-45-6\",\"status\":\"IN_REVIEW\",\"step\":null,\"dept\":\"registry\",\"owner\":\"off.reg1\",\"dueAt\":\"2026-11-30T16:30:00+07:00\",\"slaLevel\" |
