-- Block B06 (officer / head workflow): indexes for the queue (BR-16 order within a department)
-- and the workload count (IN_REVIEW held by one officer). No new columns — schema.sql already has
-- step · dept · owner · issuer · approver · return_count · returned_at · fix_deadline · reject_reason.
CREATE INDEX IF NOT EXISTS idx_cases_queue ON cases(dept, status, due_at, case_no);
CREATE INDEX IF NOT EXISTS idx_cases_owner_status ON cases(owner, status);
CREATE INDEX IF NOT EXISTS idx_cases_pending ON cases(status, due_at, case_no) WHERE status = 'PENDING_APPROVAL';
