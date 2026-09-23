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

---

## …and the same default, on functions

Everything above is about **tables**. Functions have a default privilege too,
and nobody had asked the question of it: Postgres grants EXECUTE on every new
function to `PUBLIC`, and Supabase additionally grants it to `anon` and
`authenticated` explicitly. For a `SECURITY INVOKER` function that is harmless:
the caller's own policies still run inside it. For a `SECURITY DEFINER`
function it is the whole question:

> **A definer function is a privilege, not a helper.** Inside it no policy runs,
> so its EXECUTE grant is the only check there is. Rule 1's sentence about
> `TRUNCATE`, arriving at functions.

Found while getting ready to build the first *deliberate* anonymous write path
(the online admission form). Asked first: **what can an anonymous caller
already reach?** `has_function_privilege('anon', …)` over the 57 definers in
`public` returned nine:

| | count | why it is or is not a hole |
|---|---|---|
| trigger functions | 6 | Postgres refuses to call one directly: probed as `anon`, `0A000: trigger functions can only be called as triggers` |
| `platform_slug_available` | 1 | anonymous on purpose: the signup form asks whether a slug is free before an account exists |
| `job_cancel` | 1 | refuses a tenantless caller in its first line, so it was harmless; revoked anyway so the guard needs no exception for luck |
| **`schedule_run`** | 1 | **no caller check at all** |

`schedule_run` is the scheduler's runner. It is a definer because it writes
`notification_deliveries`, which has no INSERT policy by design (rule 10). It
looks the schedule up by id with no tenant filter, and it takes the occurrence
and the digest from its caller. Probed as `anon`, the role the publishable key
in every browser bundle maps to, in a rolled-back transaction: it ran a
college's **switched-off** fee reminder to status `done`. It wrote nothing only
because none of those five families had a login yet. Once they do, anybody
holding the public key could make any college text its families on demand. And
because the occurrence was the caller's, the unique index that makes an
occurrence run once did not bind: a new timestamp is a new occurrence.

Its caller, `schedules_tick`, had been revoked from `anon` correctly. *The door
was locked and the room behind it was not.*

Migration `0267` revokes `schedule_run` from `public`, `anon` **and**
`authenticated`. Its only callers are the two ticks: `schedules_tick`, a
definer, and `schedule_digests_tick`, which pg_cron runs as `postgres` and which
resets its impersonated role before it calls the runner. Verified afterwards:
`anon` gets `42501`, `postgres` keeps execute, and the tick still runs.

### The fifth guard

`definer_guard_violations()` stands beside the schema, privilege, audit and
index guards. It returns every `SECURITY DEFINER` function in `public` that
`anon` can execute and that is not on its own list of `anonymous_on_purpose`
entries, each with its reason. It was verified by planting a definer in a
rolled-back transaction, which it named.

Two decisions about its scope:

- **It asks about `anon`, not `authenticated`.** A signed-in caller reaching a
  definer is the normal case. There are dozens, each with its own permission
  check inside. A guard that reports the normal case is a guard somebody
  switches off. The cross-tenant half of `schedule_run` (any college's member
  could run any college's schedule) is closed by the revoke, and it is
  something this guard **cannot** see. That is written here rather than implied.
- **It has a twin that needs no database.** `tests/rls/definer-grants.test.ts`
  replays every migration's `create`, `drop`, `revoke` and `grant` on functions
  and asks the same question. It reads its allowlist out of the SQL function,
  so the two cannot disagree. The first draft treated `create or replace` as a
  reset and reported `privilege_guard_violations` (revoked in `0159`, redefined
  in `0160`) as exposed. That was wrong: **`create or replace` keeps a
  function's grants, and only `drop` forgets them.** That last fact is also the
  trap worth knowing about. A `drop` + `create` to change a return type
  silently re-opens a function somebody had closed. The replay was trusted only
  after it named the same two functions as the live query before `0267`, and
  zero after it, over the same 49 definers.

### Adding a definer

Write `revoke all on function … from public, anon;` beside it, as every
definer since `0142` has, and grant `authenticated` only if a person calls it.
If an anonymous caller genuinely needs it, add it to `anonymous_on_purpose`
with the reason. Both guards will then accept it, and nothing else will.

