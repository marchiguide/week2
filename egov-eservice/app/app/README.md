# e-Service กลาง เทศบาลในฝัน (หน่วยงานสมมติ) — app

Stack: **Node 20 · Express 4 · better-sqlite3 · EJS (server-rendered HTML)** · one SQLite file · no external services.
ThaiD / PromptPay / digital signature are **simulations** only.

## 1. Run

```bash
# from the project root (folder that contains docker-compose.yml)
docker compose up --build                              # correct app, test hooks OFF (/api/test/* → 404)
TEST_MODE=1 docker compose up --build                  # test hooks ON, clock frozen at 2026-12-01T09:00:00+07:00
TEST_MODE=1 BUG_MODE=B03 docker compose up --build     # one bug on (BUGS.md) · several: BUG_MODE=B03,B07
HOST_PORT=3100 docker compose up                       # other host port (container always listens on 3000)
```

| env | meaning |
|---|---|
| `TEST_MODE` | `1` → `/api/test/*` enabled + frozen test clock · unset/empty → `/api/test/*` answers 404, real clock |
| `BUG_MODE` | comma list `B01`…`B12` (spaces/case ignored, printed at startup) · unset → 100 % correct |
| `DB_PATH` | SQLite file. Container: `/data/egov.db` = host **`./data/egov.db`** (bind mount, for TC-NFR-04 inspection) |
| `PORT` | listen port (default 3000) · `HOST_PORT` = published port in compose |
| `LOG_REQUESTS` | `1` → one log line per request (never bodies) |
| `APP_SECRET` / `DOC_HMAC_KEY` | encryption / signature keys (defaults are fixed test keys) |

With `TEST_MODE=1` the DB file is **deleted and re-seeded at every start** (disposable test DB). Without it the
DB is kept and seeded only if empty.

### Local run (agents working on one block)

```bash
cd app && npm install            # npm ≥ 11 may ask to approve better-sqlite3's build script → already in "allowScripts"
TEST_MODE=1 PORT=3104 DB_PATH=/tmp/egov-B04.db node server/index.js
```
Use **your own PORT and DB_PATH** — TEST_MODE deletes the DB file at start, so two servers must never share one.

## 2. Endpoints owned by B01

| | |
|---|---|
| `GET /api/health` | `200 {"status":"ok"}` (exactly) · no login · independent of TEST_MODE |
| `POST /api/test/reset` | `200 {"ok":true,"now":"2026-12-01T09:00:00+07:00"}` · wipes every table (sessions, OTP locks, notifications, audit, uploads …) → runs `server/seed/index.js` → clock reset |
| `GET /api/test/clock` | `200 {"now":"…+07:00"}` |
| `PUT /api/test/clock` | body `{"now":"<ISO with offset>"}` → `200 {"now":"…+07:00"}` frozen · no offset / invalid → `400 INVALID_TIME` |

## 3. Layout of the code

```
docker-compose.yml  Dockerfile  .dockerignore          (project root)
app/
  package.json                 all runtime deps (express, better-sqlite3, ejs, multer, pdfkit, qrcode, exceljs)
  server/
    index.js                   entry — auto-loads modules + migrations (do not edit)
    lib/                       shared helpers (B01) — see §5
    db/schema.sql              all tables (B01 — do not edit)
    db/migrations/<block>.sql  your schema additions, applied once, in file-name order
    modules/<name>/index.js    one folder per block (auth, citizen, officer, documents, notifications, dashboard, audit, admin, testhook)
    modules/<name>/views/*.ejs your templates           modules/<name>/public/* → /static/<name>/*
    views/layout*.ejs          shared layout + header (CONTRACT §2.1) + 403/404 page
    public/app.css app.js      shared CSS / client helpers (/static/app.css, /static/app.js)
    seed/index.js              TEST-DATA seed (B02 replaces the stub)
    rules/                     pure business rules (B03)
  e2e/                         Playwright (B11/B12)
```

### Module contract (`server/modules/<name>/index.js`)

```js
module.exports = function register(app, ctx) {         // or { register, order } · or an express.Router
  const { session, errors, db } = ctx;                  // ctx = { config, db, clock, bugs, session, audit, crypto,
                                                        //   format, codes, errors, view, counters, hooks, upload, express }
  app.get('/officer/queue', session.requireRole('officer', 'head'), (req, res) =>
    res.page(require('path').join(__dirname, 'views', 'queue.ejs'), { title: 'คิวงาน', rows: [] }));
  app.post('/api/officer/cases/:caseNo/claim', session.requireRole('officer'), (req, res) => { … });
};
```
Modules load alphabetically (`order` number to change, default 100). A module that throws while loading is
logged and skipped (`STRICT_MODULES=1` to crash instead). Async handlers are fine (`express-async-errors`).

Request pipeline: body parsers (JSON/urlencoded **10 MB**) → `/api/test/*` guard (404 unless TEST_MODE) →
**notify hook** (every request except `/api/test/*`) → `/static` → `/api/health` → session (`req.user`) →
`res.page` → modules → 404 (JSON for `/api/*`, page otherwise) → error handler (`{code,message}` JSON).

## 4. Conventions (all blocks)

* **Time** — only from `lib/clock` (`clock.now()`, `nowMs()`, `nowIso()`); never `Date.now()`/`new Date()` in rules.
  Stored as TEXT `YYYY-MM-DDTHH:MM:SS+07:00` (always +07:00, with seconds) ⇒ SQL string comparison = time order.
  Dates (holidays, `valid_until`) as `YYYY-MM-DD`. API returns the same ISO strings.
* **Display** — `fmt.thaiDateTime()` → `4 ธ.ค. 2569 16:30`, every date element carries `data-iso` (use
  `fmt.timeHtml(x, 'row-due')`), money `fmt.money(1010)` → `฿1,010`, status/level always text + colour
  (`<span class="chip status-IN_REVIEW" data-status="IN_REVIEW">กำลังตรวจสอบ</span>`).
* **Errors** — `throw new ApiError('INVALID_QTY')` or `sendError(res, 'OTP_INVALID', {attemptsLeft: 2})`; status
  and exact Thai message come from `lib/errors.ERRORS` (= CONTRACT §5).
* **PII** — idNo/mobile only as `encrypt()` in `*_enc`, lookup with `blindIndex()` in `id_hash`. Staff responses
  use `fmt.maskId()`; never log request bodies.
* **Auth guards** — `session.requireRole(...)`: page → 302 `/login` or 403 `forbidden-msg`; API → 401
  `UNAUTHENTICATED` / 403 `FORBIDDEN`. Admin/executive/auditor calling citizen/officer APIs get 403 automatically
  when you guard with the right roles. Case not visible → `session.notFound(req,res)` (404 `not-found-msg` page /
  `NOT_FOUND` JSON — same for "missing" and "someone else's").
* **Pages** — `res.page(file, {title, hideTitle, bare, scripts})`. The layout prints `app-header` + nav for the
  role + `user-name`/`user-role`(`data-role`, officers `data-dept`)/`logout-btn`/`nav-bell`+`bell-count`.
  Messages: render **one** `data-testid="action-error"` (`role="alert"`) or call `egov.showError(msg)` in the
  browser (re-uses the existing element). Buttons that must "not exist" are not rendered; unusable ones are
  `disabled`. Wrap wide tables in `<div class="table-wrap">` (no horizontal page scroll at 375 px). Every input
  needs a `<label for>`.
* **Uploads** — `upload.single('file')` (multer, memory, 20 MB hard cap) → check `size > codes.MAX_FILE_BYTES`
  yourself (`FILE_TOO_LARGE` 400, never 413); type via `upload.sniff(buffer)` (magic bytes only).
* **Audit** — `logAudit({user: req.user, event, caseNo, fromStatus, toStatus, detail})`; table is append-only
  (DB triggers abort UPDATE/DELETE).
* **Numbers** — `counters.next('case:2569')` (atomic) + `counters.formatSeq('EG', 2569, n)`; names:
  `case:<BE>` `receipt:<BE>` `doc:<BE>` `draft` `payment` (value = last issued).
* **Bugs** — `if (bug('B07')) …` from `lib/bugs`; bugs never change seed data.
* **PDF** — pdfkit writes page text hex-encoded, so an ASCII line that tests grep in the raw bytes must also be
  put somewhere literal, e.g. `doc.info.Keywords = 'docNo=… caseNo=… verify=… validUntil=…'` (Info dict is plain
  text). Thai TTF fonts in the image: `/usr/share/fonts/truetype/tlwg/Garuda.ttf` (not present on the dev host —
  fall back gracefully).

## 5. `lib/` reference

| file | exports |
|---|---|
| `config.js` | `port testMode dbPath appSecret docHmacKey defaultTestNow serverRoot appRoot` |
| `clock.js` | `now() nowMs() nowIso() set(iso) reset() isFrozen()` · `parseIso toIso toMs parts(x)→{year,month,day,hour,minute,second,weekday,dateKey,beYear}` · `fromBkk(y,m,d,h,mi,s) fromDateKey('YYYY-MM-DD','16:30') dateKey addDaysKey weekdayOfKey beYear` |
| `bugs.js` | `bug('B03') activeBugs()` |
| `codes.js` | `STATUS LEVEL ROLE DEPT LANDING SERVICES(docs, route, approver) SERVICE_IDS DOC_NAME MAX_FILE_BYTES MAX_FILES_PER_CASE AUDIT_EVENTS BACKLOG_STATUSES CLOSED_STATUSES` |
| `errors.js` | `ERRORS ApiError sendError(res, code, extra, msg) messageOf(code)` |
| `db.js` | `db` (better-sqlite3) `wipeAll() tableNames()` |
| `session.js` | `loadSession createSession(res,{kind,userId,role,dept}|{kind:'citizen',citizenId,registerOnly}, req) markRegistered(req) destroySession clearAllSessions requireLogin requireRole requireRegistering forbidden notFound unauthenticated isApi` · `req.user = {kind, role, dept, name, username, userId, citizenId, registered}` |
| `view.js` | `res.page(file, locals, status)` · `renderErrorPage(req,res,status,kind)` · template locals `user fmt codes clock nowIso testMode currentPath bellCount` |
| `audit.js` | `logAudit({...}) toApi(row)` |
| `crypto.js` | `encrypt decrypt blindIndex hashPassword verifyPassword hashPasswordCached signDocument(fields) verifyDocumentSignature randomToken randomCode(8)` · signature = HMAC-SHA256 hex of `docNo|caseNo|applicant|serviceId|issuedAt|validUntil|signer` |
| `format.js` | `thaiDate thaiDateTime thaiMonth iso timeHtml money number formatId maskId maskName isValidThaiId isValidMobile statusText levelText roleText deptText serviceName docName pct(n,d) pctText escapeHtml` |
| `counters.js` | `next(name) peek(name) set(name,value) formatSeq(prefix, be, n)` |
| `hooks.js` | `onReset(fn) onAfterReset(fn)` (only for in-memory/disk state; tables are wiped automatically) |
| `upload.js` | `single(field) any() sniff(buffer)` |
| `reset.js` | `resetAll()` |
| `notify-hook.js` | stub → **B08 overwrites**: `run(req)` called on every request except `/api/test/*`; optional `bellCount(user)` |

## 6. Data model (summary — see `server/db/schema.sql`)

`users` (staff: username, password_hash, name, role, dept) · `citizens` (id_hash, id_enc, name, mobile_enc, email,
registered) · `otp_locks` · `services` (fee_type per_copy/flat/area, fee, fee_per_sqm, sla) · `holidays` ·
`drafts` (draft_id DR-xxxx, status, qty, area_sqm, fee, fee_locked) · `files` (BLOB) · `payments` (ref PP-xxxx,
amount, qr_created_at/qr_expires_at, status) · `cases` (case_no, status, step, dept, owner, issuer, approver,
return_count, fix_deadline, paid_at, due_at, closed_at …) · `case_events` (timeline/returns/resubmits) ·
`documents` (doc_no, verify_code, signature, valid_until) · `notifications` (UNIQUE recipient+case+level) ·
`audit` (append-only) · `counters` · `sessions`.

## 7. Tests (B13) — Playwright 51 TC + BUG_MODE

```bash
# from the project root
TEST_MODE=1 BUG_MODE= HOST_PORT=8080 docker compose up --build -d
cd app/e2e && npm ci
BASE_URL=http://localhost:8080 DB_PATH=$PWD/../../data/egov.db npx playwright test     # expect 51 passed

app/scripts/run-bugs.sh            # none, none-again, B01…B12, B03,B07, B01,B05,B09, none-final (≈30 min)
app/scripts/run-bugs.sh B05        # one mode only · NO_BUILD=1 skips the image build
```
Results: `e2e/reports/bugs/<mode>.json|.log` + `summary.md` (BUGS.md §4 table). Full report: [`TEST-REPORT.md`](TEST-REPORT.md).
If Playwright says *Executable doesn't exist … chromium_headless_shell-1255*, the script links 1255 → the
installed 1254 build under `/tmp/pw-browsers` (do the same by hand with `PLAYWRIGHT_BROWSERS_PATH`).
