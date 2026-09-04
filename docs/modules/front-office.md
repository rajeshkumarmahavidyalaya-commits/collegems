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

- **No online enquiry form.** The `website` source exists and nothing writes it;
  a public form needs an unauthenticated write path, which is a deliberate
  decision this system has not taken.
- **Nothing notifies anybody.** An overdue follow-up is exactly what
  `notify_send` is for, and no code calls it.
- **No documents against an enquiry** — a birth certificate, a previous report
  card. Storage supports it; the module does not use it yet.
- **No admission test or interview scheduling**, which is a real stage between
  `applied` and `admitted` for selective schools.
- **No duplicate detection.** The same family enquiring twice makes two rows,
  and nothing notices.
- **The gate has no pass printing and no photo.** The pass number exists; what
  the visitor is handed is the school's own stationery.
