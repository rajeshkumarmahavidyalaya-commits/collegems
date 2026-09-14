# Running the tests

```bash
npm test          # everything that can run here
npm run typecheck
npm run lint
```

97 test files, and they split into two kinds that fail for different reasons.

| kind | count | needs |
|---|---|---|
| reads the source | 49 | nothing — runs on a clean checkout |
| signs in and queries | 48 | a Supabase project and two admin logins |

---

## Why the second kind skips instead of failing

Before Phase 0 of `docs/roadmap.md`, a checkout without `.env.test.local` ran
`npm test` and got **48 failed files**. `requireEnv` threw, every database suite
died in `beforeAll`, and the output was indistinguishable from a real
regression. That is this codebase's own rule turned on its own suite: *a check
that can never go green is a check people learn to ignore.*

They skip now — `describeDb` instead of `describe` — and the run is green with
a skip count.

**Skipping is not passing, and that distinction has to be visible.** So:

- `tests/global-setup.ts` prints a banner naming exactly which variables are
  missing. It lives in `globalSetup` and not `setupFiles` for a measured
  reason: a `console.warn` in a setup file is **never surfaced** by the
  reporter, so the first version of this warning was a string nobody rendered.
- `tests/harness/suite-honesty.test.ts` fails when a new database suite uses a
  plain `describe`, when the banner's variable list goes stale, or when
  `describeDb` is written as a `const` — which would be evaluated before dotenv
  had run, and would skip everything even on a machine that has the
  credentials. Each of its five assertions was verified by planting the
  violation.

---

## Setting up the two logins

The cross-tenant suite proves that one school's signed-in client cannot read,
write or delete another's rows. That needs **two administrators in two
different tenants** and cannot be faked with one account.

1. Create two users in Supabase Auth (dashboard → Authentication → Add user,
   with *auto-confirm* on). Use addresses you control.
2. Make sure two tenants exist. The product's own path is `/start`, which
   `platform_start_school` serves for a login with no tenant — that is the
   supported route and the one worth exercising.
3. Attach each login to its tenant as an administrator. If you created the
   users by hand rather than through an invitation, this is the SQL:

   ```sql
   insert into public.user_profiles (id, tenant_id, role_id, is_active)
   select
     '<auth user id>',
     t.id,
     (select r.id from public.roles r where r.tenant_id = t.id and r.code = 'admin'),
     true
   from public.tenants t
   where t.name = '<the school>'
   on conflict (id) do update set
     tenant_id = excluded.tenant_id,
     role_id   = excluded.role_id;

   -- Every RLS policy reads the JWT, not user_profiles, so the token has to
   -- carry the claims too. Without this the login is correct and sees nothing.
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
     || jsonb_build_object('tenant_id', '<tenant id>', 'role', 'admin')
   where id = '<auth user id>';
   ```

   The second statement is the one people forget. `current_tenant_id()` reads
   `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`, so a profile row on its own
   gives a login that is refused every row in the database — which is the
   correct failure mode and a baffling one to debug.

4. Copy `.env.example` to `.env.test.local` and fill in the six values.

```bash
npm test   # the banner should be gone and 97 files should run
```

---

## In CI

`.github/workflows/ci.yml` has two jobs, deliberately:

- **check** — typecheck, lint, test, build. Runs everywhere, including on a
  fork with no secrets, where the database suites skip.
- **database-suites** — runs the real thing on pushes, and **fails loudly if the
  secrets are absent**. A green tick claiming a proof that never happened is
  worse than a red one.

The suites mutate shared demo rows (issuing and returning a book, marking a
register), so `fileParallelism` is off in `vitest.config.ts`. Two runners
against one project will interfere; give CI its own Supabase project if you
ever need concurrency.

---

## What the suites will not catch

- **Anything that has never run.** Zero scheduled jobs have fired, one message
  has ever been sent, no phone has registered. See `docs/roadmap.md` Phase 1;
  the tests cannot substitute for turning it on once.
- **Load.** The demo college is 302 students. Nothing here is slow at that size
  and the dominant cost has consistently been RLS policy evaluation rather than
  rows — so measure as the caller, with `set local role authenticated` and the
  JWT claims, never in a `DO` block as `postgres`.
