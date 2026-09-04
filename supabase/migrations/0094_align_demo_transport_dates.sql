-- ---------------------------------------------------------------------------
-- Demo data: a transport arrangement should start inside its own session
--
-- Migration 0088 seeded assignments starting `current_date - 40`. That is fine
-- in isolation and wrong against a billing calendar: the demo's current session
-- runs April 2025 to March 2026, so an arrangement starting in mid-2026 is live
-- during none of that session's periods. Every monthly instalment therefore
-- billed nothing, which makes a working feature look broken.
--
-- Not a schema bug and deliberately not a new constraint: an arrangement
-- legitimately runs past the end of its session, and a child genuinely can be
-- assigned in the last week of a year. It is demo data that did not match its
-- own calendar.
-- ---------------------------------------------------------------------------

update public.transport_assignments ta
set starts_on = s.start_date
from public.academic_sessions s, public.tenants t
where t.slug = 'rajesh-kumar-mahavidyalaya'
  and ta.tenant_id = t.id
  and s.id = ta.session_id
  and ta.starts_on > s.start_date
  and ta.status = 'active';
