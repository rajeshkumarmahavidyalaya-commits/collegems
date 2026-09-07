-- ---------------------------------------------------------------------------
-- An audit log nobody can read is a table, not an audit
-- ---------------------------------------------------------------------------
--
-- 24,000 rows, an admin-only SELECT policy since migration 0008, and not one
-- caller anywhere in the application. Rule 9 got the writing right and stopped
-- there. "Who cancelled that receipt" was a question this system had the answer
-- to and no way to ask.
--
-- Everything here is `SECURITY INVOKER`. `audit_log`'s policy is already
-- exactly right -- tenant, and role `admin` -- and it is the strictest policy in
-- the schema for a good reason: **the audit log is a copy of every row in every
-- table**, so anything that could read it broadly would be a way around every
-- other policy in the database. A definer function here would be that.

-- ---------------------------------------------------------------------------
-- What actually changed
-- ---------------------------------------------------------------------------
--
-- The raw pair of jsonb documents is not an answer. Forty columns went in and
-- one of them moved, and finding it is the reader's job unless something does
-- it for them.
--
-- **`updated_at` has to come out.** Every table here carries a `set_updated_at`
-- trigger, so it changes on every update without exception -- which means a
-- diff that keeps it reports a change for a write that changed nothing, and
-- pads every real change with a line nobody wants. Observed in the live log: a
-- no-op touch on `subjects` recorded as *"1 field changed: updated_at"*, and a
-- genuine edit to a certificate template as *"body, updated_at"* where the only
-- honest answer is *body*.
--
-- It is a list rather than a single name because the next such column -- a
-- search vector, a cached count -- belongs beside it. It is **not** a general
-- "boring columns" list: `created_at` is absent deliberately, because
-- `created_at` changing is a fact somebody should see.

create or replace function public.audit_changed_fields(
  p_old jsonb,
  p_new jsonb
)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_object_agg(
      key,
      jsonb_build_object('from', p_old -> key, 'to', p_new -> key)
    ),
    '{}'::jsonb
  )
  from (
    select key from jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) as k(key)
    union
    select key from jsonb_object_keys(coalesce(p_new, '{}'::jsonb)) as k(key)
  ) keys
  where key <> all (array['updated_at'])
    and (p_old -> key) is distinct from (p_new -> key)
$$;

comment on function public.audit_changed_fields(jsonb, jsonb) is
  'The fields that moved, as {field: {from, to}}. An empty object on an update '
  'means nothing substantive changed -- `updated_at` is excluded because a '
  'trigger sets it on every write. See migration 0163.';

-- ---------------------------------------------------------------------------
-- Who did it, and the two ways that question has no answer
-- ---------------------------------------------------------------------------
--
-- `actor_id` is `auth.uid()`, which is null whenever there was no JWT: seed
-- data, an Edge Function on the service role, a definer function called by the
-- scheduler. In this tenant that is most of the log -- all 6,000
-- `attendance_records` inserts, 871 of 878 `people` inserts.
--
-- Those are **two different unanswerables** and one blank cell would hide the
-- difference:
--
--   actor_id is null            nobody was signed in. A migration, a seed, a
--                               background job. Not a person, and never was.
--   actor_id set, no profile    somebody was signed in and their login has
--                               since been removed. There WAS a person, and
--                               this is as close as the record now gets.
--
-- Same instinct as `attendance_coverage`: a rate that cannot distinguish "zero"
-- from "never measured" is a rate that lies. So does a name column.

create or replace function public.audit_actor_label(p_actor_id uuid)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select case
    when p_actor_id is null then 'System'
    else coalesce(
      (
        select (pe.first_name || ' ' || pe.last_name)
        from public.user_profiles up
        join public.people pe on pe.id = up.person_id
        where up.id = p_actor_id
      ),
      'Deleted login'
    )
  end
$$;

comment on function public.audit_actor_label(uuid) is
  '"System" means there was no signed-in user -- a seed, a migration, a '
  'background job. "Deleted login" means there was one and the account is gone. '
  'A single blank would conflate them; see migration 0163.';

-- ---------------------------------------------------------------------------
-- The history of one row
-- ---------------------------------------------------------------------------
--
-- The surface that earns its place. Rule 11 says do not add a screen to answer
-- a question -- and "show me everything that ever happened" is a catalog report
-- (below). But "what happened to *this* invoice", asked from the invoice, is
-- not a report: it has no parameters a person would type, and it belongs beside
-- the record rather than in a reporting section.
--
-- **It deliberately does not join to the row it describes.** The log outlives
-- the row -- that is most of the point of having it -- so a deleted student's
-- history has to still say what it said, and it reads names out of `old_data`
-- rather than out of `students`. The frozen-copy instinct from `substitutions`,
-- in a third place and for the same reason.
--
-- Bounded per rule 7, and the bound is stated in what it returns.

create or replace function public.audit_history(
  p_table_name text,
  p_row_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  action text,
  actor_id uuid,
  actor text,
  changed_at timestamptz,
  changed_fields jsonb,
  field_count integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    a.id,
    a.action,
    a.actor_id,
    public.audit_actor_label(a.actor_id),
    a.created_at,
    public.audit_changed_fields(a.old_data, a.new_data),
    (
      select count(*)::integer
      from jsonb_object_keys(public.audit_changed_fields(a.old_data, a.new_data))
    )
  from public.audit_log a
  where a.table_name = p_table_name
    and a.row_id = p_row_id
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

revoke all on function public.audit_history(text, uuid, integer) from public, anon;
grant execute on function public.audit_history(text, uuid, integer) to authenticated;

comment on function public.audit_history(text, uuid, integer) is
  'Everything that happened to one row, newest first, capped at 200. Reads only '
  '`audit_log`, never the table it describes -- the log outlives the row.';
