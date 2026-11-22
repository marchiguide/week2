-- =====================================================================================
-- e-Service กลาง เทศบาลในฝัน · SQLite schema (owned by block B01 — other blocks: do NOT edit,
-- add app/server/db/migrations/<block>.sql instead, e.g. ALTER TABLE cases ADD COLUMN foo TEXT;)
--
-- Conventions
--   * Time columns  : TEXT 'YYYY-MM-DDTHH:MM:SS+07:00' (always +07:00 with seconds → string order = time order)
--                     produced by lib/clock.js (clock.nowIso() / clock.toIso()) — never the machine clock.
--   * Date columns  : TEXT 'YYYY-MM-DD' (Bangkok calendar date)
--   * Money         : INTEGER whole baht
--   * PII at rest   : *_enc columns = AES-256-GCM via lib/crypto.encrypt(); lookups via *_hash = blindIndex()
--                     NEVER store a 13-digit id or 10-digit mobile in clear (TC-NFR-04 greps this file)
--   * Users         : staff in `users` (username); citizens in `citizens` (id). Audit/notifications/owner
--                     columns reference staff by username.
--   * Seed values (dueAt, closed_at, owner, …) are stored literally (A-35), not recomputed.
-- Statement-by-statement execution: keep every statement idempotent (IF NOT EXISTS).
-- =====================================================================================

-- ---------------------------------------------------------------- staff accounts (TEST-DATA §1.2)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,            -- 'off.reg1'
  password_hash TEXT NOT NULL,                   -- lib/crypto.hashPassword ('scrypt$…')
  name          TEXT NOT NULL,                   -- display name 'เจ้าหน้าที่ทะเบียน 1' (user-name)
  role          TEXT NOT NULL CHECK (role IN ('officer','head','executive','auditor','admin')),
  dept          TEXT CHECK (dept IS NULL OR dept IN ('registry','works')),  -- officers only
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT,
  updated_at    TEXT
);

-- ---------------------------------------------------------------- citizens (TEST-DATA §1.1 · DECISIONS §2 §11)
CREATE TABLE IF NOT EXISTS citizens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  id_hash       TEXT NOT NULL UNIQUE,            -- blindIndex(idNo) for login lookup
  id_enc        TEXT NOT NULL,                   -- encrypt(idNo)   13 digits, no dashes
  name          TEXT NOT NULL,                   -- 'สมชาย ใจดี' (from simulated ThaiD, read-only)
  mobile_enc    TEXT,                            -- encrypt('0812345678')
  email         TEXT,
  registered    INTEGER NOT NULL DEFAULT 0,      -- 0 = first visit must go to /register
  consent_at    TEXT,                            -- PDPA consent time
  registered_at TEXT,
  created_at    TEXT
);

-- OTP failure counter / lock per id (DECISIONS §2 · A-06). Cleared by reset.
CREATE TABLE IF NOT EXISTS otp_locks (
  id_hash       TEXT PRIMARY KEY,                -- blindIndex(idNo)
  fail_count    INTEGER NOT NULL DEFAULT 0,      -- consecutive wrong OTPs
  last_fail_at  TEXT,
  locked_until  TEXT                             -- 3rd failure time + 15 min
);

-- ---------------------------------------------------------------- service catalogue (TEST-DATA §2 · admin editable)
CREATE TABLE IF NOT EXISTS services (
  id            TEXT PRIMARY KEY,                -- 'SV-01'
  name          TEXT NOT NULL,                   -- 'ขอหนังสือรับรอง'
  fee_type      TEXT NOT NULL CHECK (fee_type IN ('per_copy','flat','area')),
  fee           INTEGER NOT NULL,                -- SV-01 per copy 20 · SV-02 flat 500 · SV-03 base (feeBase) 1000
  fee_per_sqm   INTEGER,                         -- SV-03 10 (NULL for others)
  sla           INTEGER NOT NULL,                -- business days: 3 / 10 / 15
  sort_order    INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT
);

-- ---------------------------------------------------------------- holidays (TEST-DATA §3 · admin editable)
CREATE TABLE IF NOT EXISTS holidays (
  date          TEXT PRIMARY KEY,                -- '2026-12-07'
  name          TEXT NOT NULL,
  created_at    TEXT
);

-- ---------------------------------------------------------------- drafts (no case number yet · TEST-DATA §4.2)
CREATE TABLE IF NOT EXISTS drafts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id      TEXT NOT NULL UNIQUE,            -- 'DR-0001' (counter 'draft')
  citizen_id    INTEGER NOT NULL REFERENCES citizens(id),
  service_id    TEXT NOT NULL REFERENCES services(id),
  status        TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT · PENDING_PAYMENT · SUBMITTED (paid → case_no set) · DELETED
  qty           INTEGER,                         -- SV-01 copies (default 1, A-56)
  area_sqm      INTEGER,                         -- SV-03 area
  fee           INTEGER,                         -- fee from rules/ for current inputs
  fee_locked    INTEGER NOT NULL DEFAULT 0,      -- 1 once it entered PENDING_PAYMENT (A-42: amount frozen)
  form_json     TEXT,                            -- other form fields (JSON)
  case_no       TEXT,                            -- set when paid
  created_at    TEXT,
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_drafts_citizen ON drafts(citizen_id);

-- ---------------------------------------------------------------- uploaded files (content stored in DB)
CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,                -- fileId (any format, e.g. 'F-000001')
  draft_id      TEXT,                            -- 'DR-0003'
  case_no       TEXT,                            -- set when the draft becomes a case / on resubmit
  citizen_id    INTEGER REFERENCES citizens(id),
  doc_key       TEXT NOT NULL,                   -- id-card · map · site-photo · plan · deed
  name          TEXT NOT NULL,                   -- original file name
  mime          TEXT NOT NULL,                   -- from magic bytes: application/pdf · image/jpeg · image/png
  size          INTEGER NOT NULL,                -- bytes
  data          BLOB,                            -- file content
  created_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_files_draft ON files(draft_id);
CREATE INDEX IF NOT EXISTS idx_files_case ON files(case_no);

-- ---------------------------------------------------------------- simulated PromptPay QR payments (DECISIONS §7)
CREATE TABLE IF NOT EXISTS payments (
  ref           TEXT PRIMARY KEY,                -- 'PP-0001' (counter 'payment'); new QR = new ref
  draft_id      TEXT NOT NULL,
  citizen_id    INTEGER,
  amount        INTEGER NOT NULL,                -- locked fee
  status        TEXT NOT NULL DEFAULT 'PENDING', -- PENDING · PAID · EXPIRED · VOID (draft deleted / superseded)
  qr_created_at TEXT NOT NULL,
  qr_expires_at TEXT NOT NULL,                   -- created + 15:00
  paid_at       TEXT,
  case_no       TEXT,
  receipt_no    TEXT,                            -- 'RC-2569-000031'
  created_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_draft ON payments(draft_id);

-- ---------------------------------------------------------------- cases (TEST-DATA §4.1)
CREATE TABLE IF NOT EXISTS cases (
  case_no       TEXT PRIMARY KEY,                -- 'EG-2569-000001' (counter 'case:<BE year>')
  draft_id      TEXT,
  service_id    TEXT NOT NULL REFERENCES services(id),
  citizen_id    INTEGER NOT NULL REFERENCES citizens(id),
  qty           INTEGER,
  area_sqm      INTEGER,
  fee           INTEGER NOT NULL,
  form_json     TEXT,
  status        TEXT NOT NULL CHECK (status IN ('SUBMITTED','IN_REVIEW','NEED_FIX','PENDING_APPROVAL','APPROVED','COMPLETED','REJECTED','CANCELLED')),
  step          INTEGER,                         -- SV-03 only: 1 ทะเบียน · 2 โยธา · 3 หัวหน้า (else NULL)
  dept          TEXT,                            -- department queue it sits in: registry · works · NULL (head / closed)
  owner         TEXT,                            -- users.username currently holding it (NULL = unclaimed)
  issuer        TEXT,                            -- registry officer who claimed step 1 = issues the document (A-27)
  approver      TEXT,                            -- username who approved (signer: officer SV-01 / head SV-02,03)
  approved_at   TEXT,
  return_count  INTEGER NOT NULL DEFAULT 0,      -- max 2 (A-20)
  returned_at   TEXT,                            -- last return time (NEED_FIX start)
  fix_deadline  TEXT,                            -- returned_at + 168h (A-21)
  paid_at       TEXT NOT NULL,
  payment_ref   TEXT,
  receipt_no    TEXT,                            -- 'RC-2569-000001'
  due_at        TEXT NOT NULL,                   -- SLA due (16:30); extended after resubmit
  closed_at     TEXT,                            -- COMPLETED / REJECTED time (dashboard "ปิดงาน")
  cancelled_at  TEXT,
  reject_reason TEXT,
  created_at    TEXT,
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_cases_citizen ON cases(citizen_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_owner ON cases(owner);

-- ---------------------------------------------------------------- case timeline (returns/resubmits for SLA pause)
CREATE TABLE IF NOT EXISTS case_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no       TEXT NOT NULL,
  time          TEXT NOT NULL,
  actor         TEXT,                            -- username · 'citizen' · 'system'
  actor_role    TEXT,
  event         TEXT NOT NULL,                   -- SUBMITTED · CLAIM · RETURN · RESUBMIT · FORWARD · APPROVE · REJECT · ISSUE · CANCEL · AUTO_CANCEL
  from_status   TEXT,
  to_status     TEXT,
  step          INTEGER,
  note          TEXT,                            -- reason / forward note
  data_json     TEXT
);
CREATE INDEX IF NOT EXISTS idx_case_events_case ON case_events(case_no, id);

-- ---------------------------------------------------------------- issued digital documents (TEST-DATA §5 · DECISIONS §10)
CREATE TABLE IF NOT EXISTS documents (
  doc_no        TEXT PRIMARY KEY,                -- 'DOC-2569-000001' (counter 'doc:<BE year>')
  case_no       TEXT NOT NULL,
  verify_code   TEXT NOT NULL UNIQUE,            -- 8 chars e.g. 'K7M2Q9XA'
  applicant     TEXT NOT NULL,                   -- full name (masked only on display)
  service_id    TEXT NOT NULL,
  issued_at     TEXT NOT NULL,                   -- ISO +07:00
  valid_until   TEXT NOT NULL,                   -- 'YYYY-MM-DD' last valid day
  signer        TEXT NOT NULL,                   -- display name of approver
  signature     TEXT NOT NULL,                   -- lib/crypto.signDocument(...) hex
  issued_by     TEXT,                            -- username who pressed "ออกเอกสาร"
  created_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_no);

-- ---------------------------------------------------------------- in-app notifications (DECISIONS §8 · A-30 A-31)
CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient     TEXT NOT NULL,                   -- users.username
  case_no       TEXT NOT NULL,
  level         TEXT NOT NULL CHECK (level IN ('near','overdue')),
  text          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  read_at       TEXT,
  UNIQUE (recipient, case_no, level)             -- once per level per case per person
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient);

-- ---------------------------------------------------------------- audit trail (append-only · DECISIONS §13)
CREATE TABLE IF NOT EXISTS audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  time          TEXT NOT NULL,                   -- ISO +07:00 from the test clock
  username      TEXT NOT NULL,
  role          TEXT NOT NULL,
  event         TEXT NOT NULL,                   -- STAFF_LOGIN CLAIM RETURN FORWARD APPROVE REJECT ISSUE UNMASK EXPORT ADMIN_CHANGE
  case_no       TEXT,
  from_status   TEXT,
  to_status     TEXT,
  detail        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit(time, id);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit is append-only');
END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit is append-only');
END;

-- ---------------------------------------------------------------- sequences (lib/counters.js · TEST-DATA §12)
-- names: 'case:2569' 'receipt:2569' 'doc:2569' 'draft' 'payment' … value = last number issued
CREATE TABLE IF NOT EXISTS counters (
  name          TEXT PRIMARY KEY,
  value         INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- login sessions (lib/session.js · wiped by reset)
CREATE TABLE IF NOT EXISTS sessions (
  sid           TEXT PRIMARY KEY,                -- cookie 'sid' (HttpOnly)
  kind          TEXT NOT NULL CHECK (kind IN ('staff','citizen')),
  user_id       INTEGER,                         -- users.id (staff)
  citizen_id    INTEGER,                         -- citizens.id (citizen)
  role          TEXT NOT NULL,                   -- role snapshot at login (role changes apply next login)
  dept          TEXT,
  register_only INTEGER NOT NULL DEFAULT 0,      -- 1 = citizen not registered yet: only /register allowed
  data_json     TEXT,                            -- free per-session data
  created_at    TEXT
);
