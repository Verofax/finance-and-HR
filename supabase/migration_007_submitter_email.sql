-- ============================================================================
-- Migration 007 — Store submitter email per leave request
-- ============================================================================
-- The decision-notification email was being sent to employees.email, which
-- might be NULL or set to the wrong address from a prior test. Capture the
-- submitter's email on the leave_request row itself so decisions always go
-- to whoever filled in the form.
-- ============================================================================

alter table leave_requests add column if not exists submitter_email text;

-- Backfill any existing rows: copy the linked employee's email if we have one
update leave_requests lr
set submitter_email = e.email
from employees e
where lr.employee_id = e.id
  and lr.submitter_email is null
  and e.email is not null;
