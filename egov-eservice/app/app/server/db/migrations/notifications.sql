CREATE INDEX IF NOT EXISTS idx_cases_fix_deadline
  ON cases(fix_deadline) WHERE status = 'NEED_FIX';
