-- Block B05 (citizen): lookup indexes only (no new columns).
CREATE INDEX IF NOT EXISTS idx_payments_case ON payments(case_no);
CREATE INDEX IF NOT EXISTS idx_files_citizen ON files(citizen_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(citizen_id, status);
