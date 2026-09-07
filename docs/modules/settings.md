# Settings — configuration as data, with a schema

**Migrations** `0007` (the table), `0165` (the catalogue), `0166` (engine),
`0167` (deleting the duplicated defaults).
**Screen** `/settings/school`. **Critic** `settings_problems()`.

`public.settings` has been here since migration `0007`, and it is the oldest
instance of rule 12 — configuration as data rather than as branches. It is also
the instance that shows what rule 12 leaves out.

> A rules document needs a **schema**, or nobody knows which keys exist, what
> shape a value takes, or what a missing one means.

Seven keys, no description of any of them, and no screen.

---

## The thing that was actually broken

`school.profile` was **all null in every tenant**, and nothing in the
application wrote it. Not cosmetic: it is the reason migration `0136` had to
strip `{{school.city}}` out of the shipped transfer certificate. A school could
not print its own city on its own leaving certificate, and the fix at the time
was to delete the city.

`0136`'s rule was right and stands — *a seeded default may only use values the
database is guaranteed to have*. What was missing was the other half: a way for
a school to **add** it to their own copy of the wording, deliberately, which is
what makes a template a template rather than a form. That way now exists.

Verified end to end after filling the profile in:

```
certificate_snapshot(...) ->> 'school.city'    -> "Ballia"
certificate_snapshot(...) ->> 'school.address' -> "Rajesh Kumar Mahavidyalaya,
                                                  Ballia, Uttar Pradesh, 277001"
```

---

## The thing that was waiting

`library.fine_per_day` defaulted to **2.00 in five places**:

| | |
|---|---|
| the seeded settings row | `0026` |
| `library_return_book`'s coalesce | `0026` |
| `report_library_overdue`'s coalesce | `0044` |
| `library_return_book`'s old `p_fine_per_day` argument | `0015` |
| `getFinePerDay()` in TypeScript | — |

Nobody was charged wrongly: every live reader consulted the tenant's row first
and only fell back. The cost is the one migration `0101` already paid once for
document kinds — changing the default means finding five copies, and the sixth
reader somebody writes next year invents its own. `0044`'s own comment admits
the duplication out loud (*"The same coalesce chain as `library_return_book`,
including its 2.00 fallback"*), which is the shape of a problem that has been
noticed and not fixed.

`0167` deletes four of the five. `setting_number('library.fine_per_day',
'amount')` is now the only reader and
`reference.settings_catalog.default_value` the only default. `p_fine_per_day`
stays on `library_return_book` — an explicit argument still wins, which is how a
librarian waives down on one return without changing the school's setting.

**Verified numerically either side**, because this is a money path and rule 12's
payroll lesson is that only the arithmetic finds an error like this:

```
report_run('library.overdue')  before: 5 rows, 130.00
                                after: 5 rows, 130.00
```

---

## What may not go in here

`settings` is readable by **every tenant member** — a parent, a student — by a
policy that predates all of this and is correct: a fine rate and a school
address are not secrets. That makes a catalogue an invitation to add
`razorpay.key_secret` as a key.

> **There is no `secret` value type, deliberately.** Provider credentials live
> on the Edge Functions (rule 6) and nowhere else. **If a setting needs to be
> secret, it is not a setting.**

The omission is the mechanism, in the migration, in
`src/lib/validations/settings.ts`, and in a test that asserts no catalogued key
ever matches `/secret|password|token|api_key/`. `setting_set` refuses an
undeclared key outright, so the smuggling route is closed at both ends:

```
setting_set('razorpay.key_secret', '"sk_live_…"')
ERROR:  There is no setting called "razorpay.key_secret". Settings are
        declared in the catalogue, not invented at the keyboard.
```

---

## Adding a setting

One row in a migration. The screen renders it without being edited — there is no
`if (key === "school.profile")` anywhere on the page, and adding one would be
the mistake the catalogue exists to prevent. Same bargain as `/reports`.

Three rules:

- **Declare it or it does not exist.** `setting_set` refuses an undeclared key,
  which is what makes this a catalogue rather than the bag it replaced.
- **Catalogue the shape that exists; do not reshape underneath a live reader.**
  `library.fine_per_day` is stored as `{"amount": 2.00}` rather than a bare
  number and is catalogued as an object, because five readers already parse it
  that way. `0165` writes down the schema that is there; it does not migrate a
  money path's data shape as a side effect.
- **An empty box means `null`, not `""`.** Storing an empty string would make
  `settings_problems()` count the setting as filled in, and a school would stop
  being warned that its certificates are about to print a blank address. Pinned
  in `tests/settings/settings-shapes.test.ts`.

Validation lives in `setting_set` rather than in a CHECK on `settings.value`,
for the same reason `grading_scheme_problems()` is not a constraint: the
catalogue is data, so a CHECK could not see it, and a key whose declared shape
changes in a later migration must not make the existing row unreadable.

---

## Two states, not one value

`settings_effective()` returns the value **and whether it was ever set**. A
school reading *"Library fine per day: 2.00"* needs to know whether somebody
chose 2.00 or whether nobody has ever opened this screen — the same instinct as
`attendance_coverage` (a rate that cannot distinguish zero from unmeasured) and
`audit_actor_label` (System versus a deleted login). The screen says *"Not set —
using the default"* or *"Changed by Rajesh Kumar on 2026-09-07"*.

`settings_problems()` reports two kinds of finding, and the second is the one
that had been quietly true for the life of the certificates module:

- a **required** setting nobody filled in — where an object with eight keys and
  every one null counts as empty, however present the row is;
- a key stored in `public.settings` that **no catalogue row describes** — either
  a migration added a key and forgot the catalogue, or a setting was retired and
  its rows were left behind. Both are real, they read differently, and they get
  different sentences.

---

## Verified

Against the demo tenant, as an administrator and as a teacher:

- `settings_problems()` → one warning, *School address and contact is not filled
  in* — the exact gap that broke `{{school.city}}`; zero after filling it;
- `setting_set('library.fine_per_day', '"five rupees"')` → *Library fine per day
  expects a group of fields, not a string*;
- `setting_set('razorpay.key_secret', …)` → refused as undeclared;
- as a teacher → *Your role may not change settings*, before RLS is even
  reached;
- `certificate_snapshot` resolves `school.city` and `school.address`;
- the overdue report: 5 rows / 130.00 before and after `0167`.
