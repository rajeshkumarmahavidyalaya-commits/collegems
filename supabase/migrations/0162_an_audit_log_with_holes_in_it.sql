-- ---------------------------------------------------------------------------
-- Rule 9 as an executable check, and the two tables that had slipped through
-- ---------------------------------------------------------------------------
--
-- Rule 9 says: when you add a table, add its trigger. Eighty-seven of the
-- ninety-three tables in `public` had one. Six did not, and nothing anywhere
-- would ever have said so -- which is the failure mode that matters here,
-- because **an audit log with holes in it is worse than no audit log**: it
-- answers "who changed this" with silence, and silence reads as "nobody did".
--
-- The six, sorted into the two kinds:
--
--   DELIBERATE, and now written down where the code can see it
--     audit_log          cannot audit itself -- the trigger would recurse
--     jobs               a queue. Every row is transient and its own record;
--                        auditing it doubles the write volume of the busiest
--                        table in the schema to say what the row already says
--     schedule_runs      the run register IS the audit record for schedules --
--                        that is the whole reason 0139 created it
--     notice_reads       append-only and revoked (0144). The row is the fact
--                        "this person read this circular"; there is no later
--                        edit for an audit row to describe
--
--   OVERSIGHTS, fixed below
--     notice_files       attaching or removing a file from a circular changes
--                        what the circular says. That is exactly a thing
--                        somebody asks about in March
--     notification_preferences
--                        "I never opted out of fee reminders" is a dispute, and
--                        an opt-out with nobody's name on it cannot settle it
--
-- The distinction the exemptions all share is worth naming, because it is the
-- test for the next table somebody wants to exempt:
--
--   > A table is exempt when the row *is* the record -- append-only, written
--   > once, never edited. Auditing it would store a second copy of a fact that
--   > cannot change. Every other table is audited, including the boring ones.
--
-- `jobs` is the only exemption resting on volume rather than on that rule, and
-- it is called out here rather than blended in, because volume is the argument
-- that would eventually exempt everything.

create trigger audit_notice_files
  after insert or update or delete on public.notice_files
  for each row execute function public.audit_row_change();

create trigger audit_notification_preferences
  after insert or update or delete on public.notification_preferences
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- The guard
-- ---------------------------------------------------------------------------
--
-- The third of them. `schema_guard_violations()` asks about shape,
-- `privilege_guard_violations()` about grants, this one about coverage. Three
-- functions rather than three columns on one, for the reason 0159 gave: they
-- fail for different reasons and a caller should be able to ask one question.
--
-- The exemption list is hardcoded rather than a table, deliberately. It is a
-- decision made by this codebase about its own schema -- not school policy, and
-- so not rule 12's kind of data. A tenant able to edit it could switch off its
-- own audit trail, which is the one setting an audit trail must not have.

create or replace function public.audit_guard_violations()
returns table (table_name text, reason text)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.relname::text,
    case
      when not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'id'
          and a.attnum > 0 and not a.attisdropped
      )
      -- `audit_row_change` reads `id` out of the row to fill `row_id`. On a
      -- table with no `id` it would write nulls, so this is a different fault
      -- with a different fix and it says so rather than being counted as a
      -- missing trigger.
      then 'has no id column, so audit_row_change() cannot record which row changed'
      else 'has no audit trigger -- see rule 9, and migration 0162 for the exemptions'
    end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname not in (
      'audit_log', 'jobs', 'schedule_runs', 'notice_reads'
    )
    and not exists (
      select 1
      from pg_trigger tg
      join pg_proc p on p.oid = tg.tgfoid
      where tg.tgrelid = c.oid
        and not tg.tgisinternal
        and p.proname = 'audit_row_change'
    )
  order by 1
$$;

revoke all on function public.audit_guard_violations() from public, anon;
grant execute on function public.audit_guard_violations() to authenticated;

comment on function public.audit_guard_violations() is
  'An empty result is the passing state. Rule 9 -- every table in `public` '
  'carries an audit trigger -- with four exemptions named in migration 0162, '
  'each one a table whose row is itself the record and can never be edited.';
