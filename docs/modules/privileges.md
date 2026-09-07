# Privileges — what RLS cannot refuse

**Migrations** `0159` (the revokes + the guard), `0160` (what the guard can and
cannot cover). **Guard** `privilege_guard_violations()`. **Test**
`tests/rls/schema-invariants.test.ts`.

Rule 1 says isolation is enforced by Postgres and that a missing
`where tenant_id =` is a performance bug rather than a security hole. That is
true of every statement a policy can see, and it made it easy to stop reading
there.

> **Row security policies do not apply to TRUNCATE.** The privilege is the only
> check there is.

Supabase's default `grant all on tables to anon, authenticated` includes it.
Every one of the 93 tables in `public` carried it — `audit_log`,
`ledger_entries`, `students`, all of them — behind policies that were correct
and irrelevant.

> **A correction.** Migration `0159`'s header, and the first version of this
> page, said *184 tables*. That was the row count of
> `information_schema.role_table_grants`, which has one row per table **per
> grantee** — 92 tables times `anon` and `authenticated`. `public` has 93
> tables. The finding is unchanged; the number overstated it by a factor of two,
> which is the direction that costs a reader's trust in the rest of the
> paragraph. `0159` keeps its wrong number because migrations are immutable, and
> `0161` carries the right one. Counting grants never answers "how many tables":
> use `count(distinct table_name)`, or count `pg_class`.

---

## The probe

On a scratch table with RLS on and a policy reading `for select using (false)`
— a caller who may not read a single row:

```sql
set local role authenticated;
set local request.jwt.claims = '{... "role":"parent" ...}';
select count(*) from public._truncate_probe;   -- 0 rows visible
truncate public._truncate_probe;               -- succeeded
-- as postgres, afterwards:                       0 rows left of 1
```

And afterwards, with `0159` applied, as the same caller:

```
truncate public.audit_log;
ERROR:  42501: permission denied for table audit_log
```

---

## How exposed was it, honestly

Worth stating plainly, because overclaiming a finding is its own kind of
inaccuracy. A browser holding an anon key talks to **PostgREST**, and PostgREST
emits only the SQL it builds — there is no request shape that produces a
`TRUNCATE`. Nobody was one HTTP call away from emptying the fee ledger.

What the privilege did mean is that **the last line of defence was not there.**
Anything that executes arbitrary SQL as `authenticated` — a direct connection
with `set role`, a future `SECURITY INVOKER` function that builds dynamic SQL, a
Postgres-side injection in a function that concatenates a parameter — went from
"blocked by a policy" to "blocked by nothing". The whole argument of rule 1 is
that the policy is the boundary and application code cannot be the boundary; a
privilege that no policy governs is a gap in that argument, whether or not
today's routes happen to reach it.

---

## What was revoked, and why exactly these four

A policy gates SELECT, INSERT, UPDATE and DELETE. It gates nothing else. So the
line drawn is exactly that: `authenticated` and `anon` keep the four privileges
RLS can see and lose the four it cannot.

| Privilege | What it allows, past every policy |
|---|---|
| `TRUNCATE` | empties a table in one statement |
| `TRIGGER` | attaches a function to somebody else's table |
| `REFERENCES` | points a foreign key at it — a lock on its rows, and a probe for which values exist |
| `MAINTAIN` (PG17) | `VACUUM` / `ANALYZE` / `REINDEX` / `REFRESH MATERIALIZED VIEW` |

None is used by this application: every migration runs as `postgres`, and
nothing in the app or the Edge Functions truncates anything. **`service_role`
keeps them, deliberately** — it bypasses RLS by design, so narrowing it buys
nothing and might break a platform task.

`SELECT` is untouched, which the probe checks alongside the rest: a fix that
quietly broke reading would be worse than the hole.

---

## Revoking today's tables fixes today only

The grant came from a **default privilege**, so new tables would arrive with it
back. A Supabase project has *two* default-ACL entries for `public` — one owned
by `postgres`, one by `supabase_admin` — and a table inherits the defaults of
whichever role creates it. Both are amended; the `supabase_admin` one inside an
exception handler, because a project's `postgres` is not always a member of it.

Verified by creating a table after the migration and asking:

```
has_table_privilege('authenticated', '…', 'TRUNCATE') -> false
has_table_privilege('authenticated', '…', 'SELECT')   -> true
```

---

## audit_log gets the stronger half of rule 6's pair

It had an admin SELECT policy and no write policy at all, which under RLS means
a write matches nothing and touches nothing — the *absent policy* form of
append-only. Rule 6 says to prefer the **revoke** where the table is the record
of what happened, and this is that table, so `INSERT`, `UPDATE` and `DELETE` are
now revoked from `anon` and `authenticated` outright.

`audit_row_change()` is `SECURITY DEFINER` and owned by `postgres`, which also
owns the table, so the trigger keeps writing. Verified after the revoke by
updating a row as an ordinary signed-in administrator and finding the new
`audit_log` row with the right `actor_id` — which is the whole reason that
function was written as a definer in migration `0008`.

---

## What the guard does not cover

`storage`. Its tables carry the same grants and `postgres` cannot remove them:

```sql
revoke truncate on storage.objects from authenticated;
-- no error, no warning
select has_table_privilege('authenticated','storage.objects','TRUNCATE');
-- still true
```

A `REVOKE` only removes grants **made by the role running it**. `postgres` holds
`TRUNCATE WITH GRANT OPTION` there, so the statement is legal and does nothing:
the grant to `authenticated` was made by `supabase_storage_admin`, and
`pg_has_role('postgres','supabase_storage_admin','MEMBER')` is false.

So `storage.objects` is truncatable by any signed-in user of any Supabase
project, and no statement in this repository changes that. The guard therefore
covers `public` and `reference` — the schemas this codebase creates tables in
and can keep clean — rather than staying permanently red, because **a check that
can never go green is a check people learn to ignore, and the next real
violation arrives into a test that was already failing.** Migration `0160`
records that decision where somebody will find it.

The consolation is a consequence of rule 8: losing `storage.objects` loses the
**rows, not the bytes**. The files stay in the bucket and their paths are
reconstructible from `people.photo_path`, `notice_files.path` and the other
columns that hold them — which is exactly why rule 8 says to store the path in
the database rather than treating storage as the record.

---

## Adding a table

Nothing to do. The default privileges are fixed, so a new table arrives without
the four, and `privilege_guard_violations()` fails the suite if that ever stops
being true — including if a platform upgrade resets the defaults, which is the
failure mode this guard exists for.
