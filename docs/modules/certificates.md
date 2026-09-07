# Certificates

Transfer, bonafide and character certificates — the documents a school hands
over and cannot take back.

Migrations `0132`–`0137`.

| | |
|---|---|
| `certificate_templates` | the wording, with `{{placeholders}}`, plus the boxes the issuer must fill |
| `certificates` | issued documents: a gapless serial, a frozen snapshot, the rendered text |
| `certificate_preview()` | renders it and says what is wrong with it — stores nothing |
| `certificate_issue()` | allocates the number, freezes the text, writes the row |
| `certificate_cancel()` | the only edit there is |
| `certificates.register` | the catalog report, for the auditor |

---

## The one sentence

> **Preview computes; issue freezes.**

After `certificate_issue` returns, nothing in the engine is ever consulted about
that document again. A duplicate printed in 2034 reads `certificates.body`.

This is rule 12's freeze rule — the one `exam_results.rules_snapshot` and the
report card's attendance line already made — and a transfer certificate is where
it bites hardest. By the time somebody asks for a duplicate the child has left,
the enrolment is over, the class has different children in it, and the fee
ledger has moved on. Recomputing would produce a **plausible document that is
not the one the family was given**, which is worse than failing.

So `certificates` carries:

- `snapshot` — every value that was printed, as it was;
- `body` — the rendered text;
- `template_name` and `kind` — copied down, so deleting a template can never
  alter, orphan or blank a document somebody is holding.

---

## The wording is data (rule 12)

CBSE, ICSE and a dozen state boards each prescribe a different leaving
certificate, and several prescribe the exact words. Hardcoding the first
school's is the single most common way a product like this fails its second
customer.

So a template is a row. Its `body` is free text with `{{placeholders}}`; its
`fields` declares the boxes the *issuer* must fill because the database cannot
know them — the reason for leaving, a conduct grade, the school the child is
going to:

```json
[{"name": "reason", "label": "Reason for leaving", "required": true}]
```

`certificate_snapshot()` produces about thirty keys — school, student, parents,
admission, class, session, attendance, last published result, outstanding fees,
dates — and whatever the issuer typed is merged over the top. **What the issuer
typed wins**, because a school correcting a mother's name on one certificate
must not have to correct the record first.

### A null is left unresolved on purpose

The obvious kindness is to render a missing value as a blank or a dash. It is
the wrong kindness: a leaving certificate reading *"Father's Name: —"* is a
document a school has to apologise for, and it goes out because nobody noticed.

So:

- a null value leaves its `{{placeholder}}` standing;
- `certificate_preview` lists every one that is still standing, by name;
- `certificate_issue` **refuses**.

The way out is the template's own `fields` — the issuer types the value. That is
what the column is for.

### …and one thing is deliberately not a refusal

**Outstanding fees.** Withholding a transfer certificate until dues are cleared
is a real policy at real schools and an unlawful one at others, so it is a
sentence in `problems` — *"4,200.00 is still outstanding"* — and a person
decides. Same instinct as `grading_scheme_problems()`: criticise the document in
Postgres, in sentences, and let somebody act.

`certificate_template_problems()` is the other half, and it criticises the
*wording* rather than an issue: a placeholder nothing can fill, a field asked
for but never printed, a transfer certificate that does not state the date of
admission the next school needs.

---

## Why the client cannot talk it into anything

`certificate_issue` calls `certificate_preview` again, server-side, and ignores
whatever the screen believed. So the issuing form is free to be an ordinary
React form with ordinary state: the worst a broken client can do is show the
wrong button state and then get an error.

The form is also the module's one deliberate deviation from the *"forms use the
form primitives"* convention, and the reason is in the file: **its field set is
data.** A template declares its own boxes, so there is no static Zod object to
build a resolver from, and rebuilding one on every template change would
re-mount every input and lose what the person had typed.

---

## Immutability, and which mechanism does it

CLAUDE.md's rule 4 names two shapes and this module uses the first one, which
until now had a single instance:

> A `GRANT` is role-wide, so it narrows what **everybody** may write. That is
> right when exactly one party has an UPDATE policy at all, and wrong when two
> roles need different columns.

On `certificates`, only an administrator has an UPDATE policy. So:

```sql
revoke update, delete on public.certificates from authenticated, anon;
grant update (status, cancelled_at, cancelled_by, cancel_reason)
  on public.certificates to authenticated;
```

Nobody — administrator included — can rewrite `body`, `snapshot`, `serial_no` or
`issued_on`. Both refusals are **privilege** refusals, so they raise `42501`
rather than silently matching nothing, which is the distinction rule 6's
"two ways to be append-only" note draws. The test asserts the raise *and*
re-reads the row.

`notification_deliveries` was the first instance; this is the second, which is
what turns a decision into a pattern.

### Cancelling keeps the number

DELETE is revoked outright. A cancelled certificate keeps its serial, its
snapshot and its text, and gains a reason:

> A gapless sequence with a hole in it is a sequence nobody can audit, and
> *"why is there no 0043"* is a question a school should never have to answer.

Re-issuing after a cancellation is a **new certificate with a new number**,
which is what a school has to be able to explain to whoever holds the old one.

---

## The transfer certificate is the one that changes a record

Three rules that apply only to `kind = 'transfer'`:

- **Issuing it marks the student `transferred`,** in the same transaction. Doing
  it in two steps leaves a school with certificates issued to children still on
  the roll, which is how a class list ends up with somebody who left in April.
- **At most one live one per student**, as a partial unique index — `where kind
  = 'transfer' and status = 'issued'` — not a check-then-insert, so two clerks
  pressing the button together cannot both win. Partial on `issued`, so
  cancelling reopens it. A child may hold any number of bonafides.
- **Cancelling puts them back on the roll, but only from `transferred`.**
  Somebody marked `alumni` or `expelled` since has been moved deliberately, and
  undoing that here would be a function quietly overruling a person.

The issuing screen says the first of those out loud, next to the button, before
it happens.

---

## What is deliberately not built

- **No PDF.** Certificates print through the same `data-print` CSS the report
  cards use, because a school wants this on their own letterhead in their own
  printer tray. PDF rendering is still rule 7's `jobs` work and is still not
  built.
- **No date of birth in words.** Several boards require *"Two Thousand and
  Fifteen"*, and a half-right implementation on a legal document is worse than
  none. A school that needs it declares a field and types it — which is exactly
  what `fields` is for.
- **No `{{student.address}}` or `{{school.city}}` in the seeded templates.** See
  below.

---

## Two bugs, and the rules that came out of them

### `Nothing filled {{school.city}}` — migration `0136`

The seeded transfer certificate ended *"Issued at {{school.city}} on
{{date.issued}}"*, which is what a leaving certificate normally says and which
no school can issue until somebody has filled in the school profile. The first
attempt refused, correctly and unhelpfully.

The refusal was the module working. The template was the mistake — and it was
the same one `0135`'s own header had warned about two paragraphs earlier, where
`{{student.address}}` was taken out for exactly this reason and `{{school.city}}`
was left in.

> **A seeded default may only use values the database is guaranteed to have.**
> Everything else is the school's to add once, deliberately, to their own copy
> of the wording — which is what makes it a template rather than a form.

Only untouched copies were rewritten. A school that had already adjusted its own
wording owns it now, and a migration silently rewriting it would be worse than
the bug.

### `CERTIFICATE-2025-00001` — migration `0137`

The first certificate came out with that number, because
`fees_next_document_number_for` gives an unknown kind the fallback
`upper(p_kind)` — and says so in its own comment: *"ugly and correct, and the
school can edit the row."*

Ugly and correct is the right trade for a payslip reference and the wrong one
for a number typed onto a leaving certificate that another school reads. The
kind now has a prefix (`CERT`) like every other kind.

**This is not what migration `0101` deleted.** That was a second copy of *which
kinds exist*, which the CHECK constraint already said and which made adding a
kind fail at run time. A default-prefix `case` cannot make a valid kind fail, and
the row it writes is editable afterwards.

The prefix was only corrected on sequences that had issued nothing:

> A numbering scheme that changes halfway through a year is worse than an ugly
> one.

---

## Files

| | |
|---|---|
| `supabase/migrations/0132_certificates_schema.sql` | tables, policies, the column grant |
| `supabase/migrations/0133_certificate_engine.sql` | render, snapshot, the template critic |
| `supabase/migrations/0134_certificate_issue.sql` | preview, issue, cancel |
| `supabase/migrations/0135_certificate_permissions_seed_and_report.sql` | permissions, three templates, the register report |
| `supabase/migrations/0136_a_default_template_must_be_issuable.sql` | the `{{school.city}}` fix |
| `supabase/migrations/0137_a_certificate_deserves_a_prefix.sql` | `CERT-2025-00001` |
| `src/lib/validations/certificates.ts` | parsing and labels |
| `src/app/(app)/certificates/` | register, issue, printable document |
| `tests/certificates/certificate-forms.test.ts` | the client half, without a database |
| `tests/certificates/certificates-db.test.ts` | freezing, numbering and the transfer rules, through real RLS |
