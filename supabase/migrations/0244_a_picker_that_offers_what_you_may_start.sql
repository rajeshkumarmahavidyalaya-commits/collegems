-- 0244 -- A picker that offers what you may start.
--
-- `reference.job_kinds` is in `reference`, which PostgREST does not expose —
-- the same as `reference.reports` and `reference.checks`, and for the same
-- reason: rule 1's schema guard covers `public`, so a catalogue that belongs to
-- no college lives outside it and is reached through a function.
--
-- `0242` shipped the catalogue and no way to read it, which is this file's
-- oldest shape (*"a correct write path nobody can call"*) wearing a read.
--
-- And the function is not a plain `select`, because `report_list()` already
-- settled what the right shape is:
--
-- > **It filters by the caller's own permission matrix**, so the picker offers
-- > exactly what a subsequent `job_enqueue` would accept. *A control that will
-- > refuse you is worse than no control, because it costs the person the work
-- > of trying* — the fourth instance of that defect this codebase has fixed,
-- > after a teacher taken through a whole certificate form to meet a Postgres
-- > error, an accountant shown every schedule switch, and an unmapped plan
-- > drawing a Buy button.
--
-- The refusal in `jobs_check_enqueue` stays exactly as it is. This narrows what
-- is *offered*; the trigger is what makes it true.

begin;

create or replace function public.job_kinds_available()
returns table (
  key text,
  label text,
  description text,
  required_permission text,
  page_size integer
)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  select k.key, k.label, k.description, k.required_permission, k.page_size
  from reference.job_kinds k
  where k.is_active
    and public.role_has_permission(k.required_permission)
  order by k.sort, k.label
$$;

revoke all on function public.job_kinds_available() from public, anon;
grant execute on function public.job_kinds_available() to authenticated;

comment on function public.job_kinds_available() is
  'The kinds of background job this caller may start, filtered by their own '
  'permission matrix -- report_list()''s shape, so the picker and the enqueue '
  'cannot disagree. SECURITY INVOKER; the enforcement is the BEFORE INSERT '
  'trigger on jobs, not this.';

-- …and the names for a job already in the register, which may name a kind the
-- caller could not start today (somebody else queued it) or one the catalogue
-- has since retired. A label is not a permission, so this one is not filtered:
-- withholding the *name* of a row the policy already showed them would render
-- "Waiting" beside a blank.
create or replace function public.job_kind_labels()
returns table (key text, label text)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  select k.key, k.label from reference.job_kinds k
$$;

revoke all on function public.job_kind_labels() from public, anon;
grant execute on function public.job_kind_labels() to authenticated;

commit;
