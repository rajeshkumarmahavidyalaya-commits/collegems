# Notice board

Circulars, event announcements and anything else the school wants people to be
able to read *again*.

Migrations `0144`–`0146`.

| | |
|---|---|
| `notices` | the document, its audience and its window on the board |
| `notice_files` | attachments, by object path, in the `documents` bucket |
| `notice_reads` | one row per person per notice, written once |
| `notice_matches_me()` | *"is this one for me"* — the predicate the RLS policy uses |
| `notice_publish()` / `notice_announce()` / `notice_withdraw()` | |
| `notices.reach` | the catalog report |

---

## The distinction the whole module rests on

> **A notice is a document with an audience. A notification is the fact that
> something was announced, once.**

`reference.notification_types` has carried a `notice.published` event since
migration `0033` with nothing behind it. This is what it was for — and building
it meant deciding what a notice is *not*.

Collapsing the two fails in both directions:

- Treat a notice as a notification and there is **no board** — nothing to come
  back to in March to check what the fee circular actually said.
- Treat a notification as a notice and **every typo correction re-sends four
  hundred SMS**.

So they are separate tables with one deliberate join: publishing a notice calls
`notify_send` exactly once. Rule 10 already draws this line one level down —
*"did the notice go out" and "did Ravi's mother's SMS arrive" are different
questions* — and this carries it up.

Three consequences, each enforced rather than hoped for:

| | |
|---|---|
| **Editing never announces** | There is no trigger on update and no call in the server action. |
| **Publishing announces once** | `announced_count` is the record. Re-publishing a withdrawn notice does not re-announce it. |
| **Announcing again is deliberate** | `notice_announce()` is its own function with its own audit row — not a boolean on publish whose meaning depends on what happened before. |

---

## Who can see one is a policy, not a query

The audience is the same `jsonb` the notification module resolves —
`{"kind":"section","section_id":…,"who":"parents"}` — and the **RLS policy asks
it directly**:

```sql
create policy "the audience views published notices" on public.notices
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and status = 'published'
    and (starts_on is null or starts_on <= current_date)
    and (expires_on is null or expires_on >= current_date)
    and public.notice_matches_me(audience)
  );
```

A parent addressed by a Grade 4 circular can read that row; a parent who is not
cannot — in Postgres, not in a filter somebody might forget. Rule 4: the UI is
never the gate. Consequently there is no filtering in `notice_board()`, none in
the page, and no `roles` on the nav entry: **a menu that guessed at the audience
would be a second answer to a question Postgres already answers.**

Verified against the demo tenant: a caller whose profile role is `admin`, asking
as a non-staff role, sees the "everybody" notice and the admin-only circular and
**not** the teacher-only one.

### …and why it is a predicate rather than a resolution

`notify_resolve_audience` answers *"who does this audience mean"*, which is right
for fanning one message out to four hundred people. A board asks the opposite
question about twenty rows — *"is this one for me"* — and resolving the audience
of every notice to compare lists would be twenty fan-outs to render one page.
`notice_matches_me` is that inverse, and the two share one vocabulary so a
circular and the SMS about it can never reach different people.

---

## A failed announcement is not a failed publish

`notify_send` refuses an audience that matches nobody with a login, and it is
right to: a person who pressed Send deserves to be told it went nowhere. But:

> **The board is the point and the announcement is a courtesy.** A Grade 1
> circular whose parents have no logins yet must still go up.

So the announcement is attempted inside an exception block and its failure is
**written down** — `last_announce_error` holds the reason, `notice_publish`
returns it, and the screen says *"Published. Nobody was notified: … It is on the
board either way."*

A caught exception with nowhere to put the message is how a school ends up
believing four hundred parents were told. Recording it is what makes the catch
legitimate rather than a swallow.

The first live publish proved it: a teacher-only circular in a demo tenant where
no teacher has a login came back `status = published`, `announced_count = 0`,
`last_announce_error = "That audience matched nobody with a login, so nothing
was sent"`.

---

## Read receipts

*"Has every parent seen the fee circular"* is the question a board can answer and
a broadcast cannot, and it is most of the reason to have one.

- **Written on view, not on a click.** A receipt that needs a button measures who
  pressed a button, which is a different and much less useful fact.
- **Idempotent, and `read_at` never moves.** A page refreshed thirty times is one
  receipt with its original timestamp — when they *first* read it is the only
  version of that fact worth keeping.
- **A person may only write their own.** The INSERT policy compares
  `user_id = auth.uid()`; a parent who could insert somebody else's receipt could
  make a circular look read.
- **`UPDATE` and `DELETE` are revoked outright**, so an attempt raises `42501`
  rather than silently matching nothing — the `ledger_entries` flavour of
  append-only from rule 6, chosen because there is no legitimate edit to a
  receipt and a school that could clear them could claim anything about who was
  told.

Withdrawing a notice **keeps the receipts**. Who had already seen a circular
before it was pulled is exactly the question somebody asks afterwards.

---

## Attachments

`homework_files`'s shape, narrowed to one parent, in the `documents` bucket. The
three rule-8 properties are the load-bearing part:

- **The object path is stored, never a URL**, and the row is unique on the path
  so deleting one is never ambiguous.
- **The signature is the authorization.** `attachmentUrl` reads the row back
  through RLS *first* and signs only if the select returned something — so a
  notice withdrawn this morning stops producing links this morning. The download
  is a **button, not a link**: rendering a signed URL into the page signs it
  before anybody asked, which is the same as publishing the file.
- **Orphans have a direction.** Upload the object, then insert the row, deleting
  the object if the insert fails; on delete, remove the object *before* the row,
  while the path is still readable.

A file is exactly as visible as its notice, written as a subquery on `notices`
rather than by repeating the audience test — so the two can never disagree.

---

## Seeded published, unlike the schedules

The scheduler's starters arrive **switched off**; the board's one notice arrives
**published**, and the difference is the point:

> A schedule that arrived switched on would text four hundred parents without
> anybody deciding to. A notice that arrives on the board is a sentence on a
> page.

Its `announced_count` is seeded at 1 so that a later `notice_publish` on it can
never announce a seeded row to a real school.

---

## Files

| | |
|---|---|
| `supabase/migrations/0144_notices_schema.sql` | the three tables, `notice_matches_me`, the policies |
| `supabase/migrations/0145_notice_engine.sql` | publish, announce, withdraw, mark read, the board |
| `supabase/migrations/0146_notice_permissions_seed_and_report.sql` | permissions, one notice, the reach report |
| `src/lib/validations/notices.ts` | the three publish outcomes, as sentences |
| `src/app/(app)/notices/` | the board, one notice, and the writer's screen |
| `tests/notices/notice-forms.test.ts` | those sentences, without a database |
| `tests/notices/notices-db.test.ts` | the policy, the announce-once rule and the receipts, through real RLS |
