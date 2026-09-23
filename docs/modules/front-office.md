# Front office (Phase 5.4)

The admissions funnel, and the gate register.

Everything else in this system starts with a student who already exists. This
is the module that comes before that: the parent who telephoned in November, was
called back twice, visited in December, and became a student in April. Losing
that trail is how a school forgets who it turned away.

Migrations `0098`–`0101`.

---

## An enquiry is not a person

The tempting shortcut is to create a `people` row the moment somebody rings.
It is wrong twice over:

- A name written on a pad at the front desk is **not yet a human this school
  holds records about**. Most enquiries never become anything.
- Doing it would fill `people` with a duplicate of every family that ever asked
  about fees, and the identity model (rule 5) is the one part of this schema
  that must stay clean.

So `enquiries` is its own table, and it becomes a person exactly once — at
admission, through `enquiry_convert`.

**That function calls `admit_student`.** It does not write `people`, `students`
and `enrolments` itself. There is one admission path in this system and a child
arriving through the front office is not a different kind of child; a second
insert path is how two admission numbering schemes and two sets of defaults end
up in one database.

---

## Three ways the funnel is kept honest

A sales funnel that anybody can edit is a funnel that always looks good in
March. Each of these is a constraint, not a convention.

### A status cannot claim an admission that did not happen

```sql
constraint enquiries_admitted_chk check (
  (status = 'admitted') = (converted_student_id is not null)
)
```

The same shape as `exams_published_chk`: a status and the evidence for it kept
in step, so no code path can assert one without the other. Verified — an
`UPDATE ... SET status = 'admitted'` is refused with `23514`.

`enquiry_log_follow_up` refuses `admitted` as a note outcome for the same
reason, with the sentence *"Mark an enquiry admitted by admitting the child, not
by logging a note"*, and the browser's outcome list omits it so the form cannot
offer what the database will refuse.

Converting twice is refused by name (*"Enquiry ENQ-0004 was already admitted on
…"*), and `enquiries_one_per_student` — a partial unique index — means a retried
conversion after a timeout cannot produce a second student.

### A loss must say why

```sql
constraint enquiries_lost_chk check (
  (status = 'lost') = (lost_reason is not null and btrim(lost_reason) <> '')
)
```

*A school that cannot say why it loses families cannot fix it.* This is the one
field in the module that exists purely so the data is worth reading later.

### The call log cannot be tidied

`enquiry_follow_ups` has a SELECT policy and an INSERT policy and **no UPDATE or
DELETE policy for anybody** — the same mechanism as `ledger_entries`, where the
absence is the point.

Worth noting how this was verified, because the first attempt was wrong: an
`UPDATE` with no `WHERE` **succeeds** under RLS while matching nothing, so a
test that only checks for an error passes whatever the policy says. The real
assertion is the row count:

```
rows the office can read : 9
rows an update touched   : 0
rows a delete touched    : 0
```

---

## An enquiry nobody can ring back is refused

`enquiry_create` will not accept a contact with neither a phone number nor an
email. It is the only validation in the module that is really about *purpose*:
this register exists so somebody can follow up, and a row that cannot be
followed up is a row that will be forgotten. Enforced in Postgres and mirrored
in the form.

---

## The gate

`visitors` answers one question — **who is in the building, and why** — and the
constraint that makes it able to is this:

```sql
create unique index visitors_one_open_visit
  on public.visitors (tenant_id, phone)
  where checked_out_at is null and phone is not null;
```

A register where the same person is signed in three times because nobody signed
them out cannot answer its own question. Partial, so the same visitor returns
tomorrow without trouble; and the refusal names the existing pass, which turns
an error into an instruction:

> *"That number is already signed in on pass VP-2025-00001 since 07:45. Sign them
> out first."*

`visitors_checked_out_by_chk` pairs the timestamp with the person who recorded
it, so a sign-out always says who did it.

**`id_proof_last4` is four characters and there is no upload.** A photocopy of
somebody's identity document at a school gate is a liability, not a security
measure. The column is regex-constrained to four characters and the storage
buckets are not involved.

---

## One document numberer

Adding enquiry and pass numbers failed with `Unknown document kind:
visitor_pass` — because `fees_next_document_number_for` carried **its own list**
of kinds alongside the CHECK constraint that already said so. Worse, migration
`0073` had already worked around that by hand-copying the whole
insert-then-increment into `accounts_next_voucher_number`. Front office would
have made it three.

Migration `0101` fixes it:

- The function stops repeating the kind list. `document_sequences_kind_check`
  owns it, and a bad kind now fails on the insert with the constraint's own
  error. **Adding a kind is one ALTER**, not an ALTER plus a function nobody
  remembers.
- The prefix default becomes a small map with a legible fallback — the prefix
  itself was already a column, so a school that wants `ADM` instead of `ENQ`
  edits a row.
- `accounts_next_voucher_number` is now one line over the shared function, so
  the gapless guarantee is proved once.

The general lesson: *a list of valid values belongs in one place, and the
constraint is usually that place.*

---

## Screens

`/front-office` — two tabs. **Enquiries** sorted by who needs ringing back
first, with the funnel counts above them and a conversion rate. **Gate**, with
who is inside and for how long.

The conversion rate is a share of enquiries that have **finished**, not of every
enquiry ever logged. Counting open enquiries as failures makes the number
meaningless in November and flattering in March; a test pins it.

The funnel is six numbers rather than a chart, deliberately — this is a screen
somebody glances at between phone calls.

---

## Permissions

RLS restricts every table here to `admin` and `accountant`: an enquiry holds a
child's date of birth and a family's phone number before either has any
relationship with the school, so teachers and families are not in it at all.

The matrix draws the line RLS does not: **taking an enquiry is not the same as
admitting a child.**

- `frontoffice.view` — the board and the register
- `frontoffice.manage` — record enquiries, follow-ups, visitor passes
- `frontoffice.admit` — turn an enquiry into a student

---

## Not built

- **Nothing notifies anybody.** An overdue follow-up is exactly what
  `notify_send` is for, and no code calls it.
- **No documents against an enquiry** — a birth certificate, a previous report
  card. Storage supports it; the module does not use it yet.
- **No admission test or interview scheduling**, which is a real stage between
  `applied` and `admitted` for selective schools.
- **No duplicate detection at the desk.** The same family enquiring twice by
  phone makes two rows, and nothing notices. The online form does suppress a
  repeat of the same child and contact within a day (below); the desk does not.
- **The gate has no pass printing and no photo.** The pass number exists; what
  the visitor is handed is the school's own stationery.

---

## The online application form (migration 0268)

The note above read *"a public form needs an unauthenticated write path, which
is a deliberate decision this system has not taken."* This is that decision,
taken on purpose and bounded. Until now, a family that found a college online
could only telephone. On the demo college, 2 of 8 enquiries said `website`, and
both had been typed in by staff.

**It came second, on purpose.** Before adding the first anonymous write path,
the question was what an anonymous caller could already reach. The answer was
`schedule_run`, which would text any college's families on demand. `0267`
closed that and added the definer guard, and this form is built against the
guard (see [privileges.md](./privileges.md)).

### The shape

| | |
|---|---|
| `/apply/<college slug>` | public in the middleware; a Server Component; no account |
| `admission_form(slug)` | `SECURITY DEFINER`, granted to `anon`: the college's name, current year, class levels and its own note, **or null** |
| `admission_apply(slug, application)` | `SECURITY DEFINER`, granted to `anon`: one website enquiry, or a sentence |
| `admissions.online` | a catalogued setting, **off by default**: `enabled`, `per_hour` (default 30), `note` |
| the front-office card | the address to put on the college's website, shown to `frontoffice.manage` |

No table policy is opened to `anon`. As `anon`, `select * from enquiries`
returns **0 rows**, both before and after this migration. Both functions are
named, with their reasons, in `definer_guard_violations()`.

### What the applicant decides, and what they do not

The applicant decides the child and the contact, within bounds: names up to 80
characters, contact name up to 120, a phone matching `^[0-9+() -]{6,20}$`, a
shaped email, a real past date of birth, and a class level that belongs to
**this** college. The function decides everything else:

- **the year**, from `current_session_id` (rule 2);
- **the number**, from the gapless numberer (rule 6);
- **`source = 'website'` and `status = 'new'`**;
- **a follow-up due today**, where the college is, so the application is at the
  top of the office's list the morning it arrives.

The static guard (`tests/admissions/public-form.test.ts`) checks that
`admission_apply` reads exactly the keys the action sends, in both directions.
It also checks that it never reads a tenant, a year, a source or a status from
its caller.

### What an anonymous caller can learn

- **One null for every reason the form cannot show.** An unknown slug, a closed
  college and a college with no current year all get the same answer. So do the
  write's refusals: one sentence for all three reasons. This is `0209`'s *the
  refusal says nothing*.
- **Only its own reference number.** A repeat of the same child and contact
  within a day returns the **first** reference and files nothing. Pressing the
  button twice is the common case, and a duplicate row is the office's problem.

### Bounded

The limit is per college, per hour, and counted under an advisory lock. It is
rule 4's answer for a rule about how many other rows exist. The duplicate check
runs first, so pressing the button again never uses up the college's hour. The
setting's `per_hour` is clamped to 500 in SQL: *a setting is a decision, and a
clamp is a bound.* The honest cost: somebody can fill 30 rows an hour into one
college's board, and the *Lost* button is the answer. The honeypot field stops
the cheapest scripts and is described as a courtesy, not a bound.

Probed as `anon`, in a rolled-back transaction, with the limit at 3:

| step | result |
|---|---|
| form, closed college / unknown slug | `null` / `null` |
| apply, closed | *This college is not taking applications online at the moment.* |
| form, opened | name, `2025-2026`, its 6 class levels, the note |
| apply | `ENQ-2025-00001` |
| the same child again, different case | `ENQ-2025-00001`, `duplicate: true`, no row |
| a class level from nowhere | *Choose a class from the list.* |
| 2nd, 3rd, 4th distinct application | `-00002`, `-00003`, then the hourly refusal |
| a phone reading `call me; drop table` | *That phone number does not look right.* |
| 31 February | *That date of birth is not a real date.* |
| `select` on `enquiries` / `setting_value_for` | 0 rows / `42501` |

The rows landed as `website | new | due 2026-09-23 | 2025-2026`, with the
email lowercased.

### Three things worth keeping

- **The audit trail reads *System*, and that is correct.** `auth.uid()` is null,
  which is the payment webhook's case exactly (`0215`): *nobody was signed in.*
  The row's own `source` says who it was. The audit layer is deliberately not
  given a second meaning for null.
- **One place a default is applied, for a named college.** `setting_value`
  read `current_tenant_id()`, which is null for an applicant. Rather than write
  the coalesce a second time, `setting_value_for(tenant, key)` became the
  definition and `setting_value` its wrapper. This is safe for the reason rule 6
  gives `notify_send_for`: `settings` is readable by every member, so its
  protection is a tenant check and nothing narrower.
- **React resets an uncontrolled form once its action settles.** Without the
  submitted values handed back, a parent who mistyped one digit would have found
  every field empty. The action returns them and the form remounts with them.
  This was checked in a browser, in English and Hindi: errors in the reader's
  language, values kept, focus on the summary, `aria-invalid` on the field.

### Found on the way, and not fixed here

- **The settings screen draws its controls on `settings.manage` for every key**,
  while each key names its own `permission_code` and `setting_set` checks that
  code. The accountant holds `frontoffice.manage` and not `settings.manage`, so
  the function would admit them and the `admins manage settings` policy would
  then refuse them with a raw RLS error. The screen, drawn read-only, is the half
  that agrees with the boundary. The front-office card asks the screen's
  question, `settings.manage`, rather than sending an accountant to a page that
  is read-only for them. Making per-key permissions load-bearing is the policy
  rewrite rule 4 already names.
- **The seed's enquiry numbers are `ENQ-0001` to `ENQ-0008`, written by hand
  with no sequence row**, so the first numbered enquiry is `ENQ-2025-00001`.
  They cannot collide, because the formats differ. The office's own
  `enquiry_create` does the same.

### Not built

- **No notification to the office when one arrives.** It lands at the top of the
  board with a follow-up due today, which is where the office already looks. An
  event nothing subscribes to would be `0219`'s *catalogue entry, not a
  feature*.
- **No documents with an application.** An anonymous upload is a second
  anonymous write, into Storage, and it deserves its own decision.
- **No confirmation email to the applicant.** The reference is on the screen.
  An email would be a message addressed to an address nobody has verified,
  which makes it a way to send mail to strangers from the college's name.

