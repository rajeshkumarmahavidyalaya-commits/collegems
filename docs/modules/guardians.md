# Guardians — the write path nobody had

**Migrations** `0221` (the four functions, the one-primary index, and the
importer keeping what it collected), `0222` (the preview naming a value the
CHECK will refuse), `0223` (searching for a sibling's parent).
**Functions** `guardian_add`, `guardian_link`, `guardian_update`,
`guardian_unlink`, `guardian_search`, `allowed_values`, `words_or`.
**Screen** the student record. **Permission** `guardians.manage`.
**Guard** `tests/students/guardians.test.ts`.

---

## What was missing

`guardian_student` decides which family sees which child. The fee account, the
timetable, `/arrangements`, the evening absence notice and the whole mobile
contract resolve through it — and **nothing in the application could create a
row in it.**

Swept before writing `0221`:

| | |
|---|---|
| `guardians` / `guardian_student` in `src/` | nowhere but the generated types |
| functions in `public` mentioning `guardian_student` | **11, all readers** |
| links on the demo college | 555, every one from the seed |

`guardians.manage` — *"Create/update guardians and student links"* — had been in
the catalogue since `0005` and was named in `NOT_YET_A_CONTROL` with the reason
*"the permission is right and the screen is unbuilt"*. That entry is gone.

## The live half, which was worse than the missing half

The bulk import **collects** a guardian. `import_validate_run` refuses a row for
one: *"A guardian with no phone number cannot be contacted"*. Then
`import_apply_run` called `admit_student` and never mentioned a guardian again —
0 occurrences of the word in its whole body.

Measured on the demo college, and the numbers meet in the middle:

```
import rows naming a guardian     3
students with no guardian         3   (of 303)
guardians created by the import   0
```

A field collected, validated, and dropped — `0220`'s defect in a second module,
found because that one taught what to look for. The office typed a mother's name
and telephone number, the importer checked the number was there, and the child
arrived at a school that cannot contact anybody.

## One definition, consulted by both

`guardian_add` is the only way a guardian is made, and `import_apply_run` calls
it. Rule 6's sentence about billing, applied to people: *one definition of "what
would this child be charged", consulted by everything — a second implementation
is a second answer.* The importer and the office screen cannot disagree about
what a guardian is, because there is one of them.

The guardian is created in **its own sub-block** inside the import loop, after
`applied_student_id` is set. A guardian that fails to save must not lose the
child: rule 13's *"apply partially and record why"*, so the reason lands on the
row and the batch carries on.

## At most one primary contact

`is_primary` had been a bare boolean since `0003`, so nothing stopped a child
having three — and `students/actions.ts` does `links.find((l) => l.is_primary)`,
which means *the first row the join happens to return*. Two screens could name
different parents for one child.

Rule 4's second-row rule: no CHECK sees another row, so it is a **partial unique
index** on `(tenant_id, student_id) where is_primary`. Verified clear before
adding it — 0 children had two.

`guardian_link` then **demotes the incumbent** in the same statement rather than
letting the index refuse the write. The constraint is the boundary; that is the
manners. Somebody naming a new primary contact has already decided, and sending
them off to un-tick a box elsewhere is a rule enforced at the person instead of
at the data.

## Probed as each seat

In a rolled-back transaction, as a signed-in administrator:

| step | result |
|---|---|
| `guardian_add` claiming primary | created; **1** primary for the child, incumbent now `false` |
| `guardian_link` to a second child | 2 children for one guardian |
| `guardian_link` again, different relationship | **1** row, relationship updated — an edit, not an error |
| `guardian_update` | reaches the person, so every child of theirs |
| `guardian_unlink` | 1 link removed; **the guardian row survives**; 1 child left |
| unlink twice | 0 rows |
| a nameless guardian | *"A guardian needs a name"* |
| an unknown child | *"No such student, or you cannot see them"* |

And as a teacher, whose JWT says so:

| step | result |
|---|---|
| `guardian_add` | `42501 new row violates row-level security policy for table "people"` |
| `guardian_link` | `42501 … for table "guardian_student"` |
| `guardian_unlink` | **0 rows deleted** — the count is the answer, not an error (rule 6) |

The functions are `SECURITY INVOKER` over administrator-only policies, so the
boundary is Postgres either way. `guardians.manage` decides whether somebody is
*walked through a form* that will refuse them at the end of it.

## `0222` — the preview said two of two were ready

Probing `0221`'s importer fix end to end, with two rows — one saying `mother`,
one saying `Grandmother` — found the next thing along, and all three of its faces
in one screen:

```
validate ready                2 of 2
problems named by the preview none
apply                         2 applied, 0 failed
line 1 (mother)               student yes, guardians 1
line 2 (Grandmother)          student yes, guardians 0,
  error: Student imported; the guardian could not be added: new row for
         relation "guardian_student" violates check constraint
         "guardian_student_relationship_check"
```

Rule 13's preview is *editable rows a person can edit*, and it told the office
the file was ready. The child went in, the mother did not, and the sentence
explaining why is a constraint name.

**The asymmetry says it was an oversight rather than a decision.** `import_rows`
collects `gender` and three guardian columns. Gender has a normaliser *and* a
sentence — `normaliseGender` turns `M`, `Male` and `boy` into `male`, and the
validator answers an unrecognised one in words. The relationship column was
passed through verbatim, so a spreadsheet saying `Mother` — which is what a
spreadsheet says — was refused by a CHECK that only allows `mother`.

So: **case is normalised, an unknown word is named.** `Grandmother` is not
silently filed as `guardian`; that is the office's decision, on a screen that now
exists. After `0222`, the same three rows read:

```
validate ready    2 of 3
line 2            "Grandmother" is not a relationship this product records
                  — use father, mother, guardian or other
line 3 (Father)   student yes, guardians 1, relationship father
```

Line 3 is the half that matters more: `Father` would have failed before.

### …and the list of legal values now has one owner

The convention says *"a list of valid values belongs in one place, and the
constraint is usually that place"* — and then the gender message spelled the four
words out a second time. They agreed, which is exactly `library.fine_per_day`'s
lesson: copies that agree cost nothing until the day one of them has to change.

`allowed_values(table, column)` reads the `col = ANY (ARRAY[…])` CHECK and
returns its literals, and `words_or()` joins them into a sentence. Both are **for
wording, never for enforcement**: if a constraint is reshaped past what the
parser recognises the array comes back empty, the validator stops naming the
problem, and the CHECK still refuses the write — degrading to exactly the old
behaviour rather than to a hole.

`words_or` is English because every sentence it appears in is:
`import_rows.problems` holds English strings. `Intl.ListFormat` owns the
conjunction and there is no `Intl` in Postgres, so that seam is written down
rather than left as an accident.

There is a **second** copy of the list, in `src/lib/validations/guardians.ts`,
because a `<Select>` cannot ask a CHECK what to draw. The guard reads the
migration and fails if the two stop agreeing, which is the only thing that makes
a second copy safe to keep.

## `0223` — a search box is not a filter string

Linking a sibling needs *which guardian already here is this child's mother?*
The first draft was PostgREST, filtering an embedded table:

```ts
.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`, { referencedTable: "people" })
```

**That string is a filter language, and `term` is somebody's typing.** A guardian
searched for as `O'Brien, R` closes the `or(` group early. It is not a way into
another tenant's rows — RLS is unmoved by any of it — but "the search box breaks
on a comma" is a defect a school meets in its first week, and the fix is not to
escape more carefully. It is to stop building a query out of text.

`guardian_search(p_query)` takes it as a **bound parameter**, is `SECURITY
INVOKER` so RLS decides, is bounded at 20 per rule 7, and ends in an `order by`
with the id as a tiebreak — a search with no order returns an arbitrary twenty of
the matches.

Probed: 20 for a name fragment, 20 for a phone fragment, **0** for a single
character, **0** for `O'Brien, R)` rather than an error, and **0** rows to the
other college's administrator.

The projection is `name · phone · occupation · children`, and that is not
decoration: the demo college has three different guardians called *Ananya
Sharma*, and a picker showing only a name cannot tell them apart.

## What the screen costs

The card is the route's only client code, and the i18n catalogue is one 57 kB
chunk pulled in by any route that calls `useI18n()` in the browser. Three builds
of the same page:

| `/students/[id]` | First Load JS |
|---|---|
| before — a pure Server Component | 167 kB |
| with `useI18n()` in the card | **217 kB** |
| with the names resolved by `await getT()` and passed as props | **170 kB** |

The `PhotoControl` bargain from the ID-card batch, and the reason it is a guard
rather than a comment: putting the hook back would compile, pass every other
check, and cost the route 47 kB silently. Both dialogs are behind `next/dynamic`
as well — *a conditional render is not a conditional load* — so react-hook-form
and the Zod resolver arrive on the click that opens them.

## What it deliberately does not do

- **Unlinking never deletes the guardian.** They may have other children here,
  and a person who is nobody's guardian any more is still the person who paid
  last year's fees. Same instinct as `student_exit` ending a bus seat rather than
  cancelling it — and it makes the action reversible, which the confirmation
  says.
- **No guardian login is created.** A family's account is an invitation
  (rule 3), and conflating "who to telephone" with "who may sign in" would hand
  a login to every contact in the school. The demo college still has **no parent
  logins at all**, which `docs/modules/family.md` already names as the sharper
  finding.
- **`guardian_relationship` is not editable in the import preview**, because the
  preview table has no guardian columns at all — the name and telephone number
  have always been fixed by re-uploading. What `0222` adds is that the problem is
  *named* before the child is imported without their mother; the row can be
  skipped and the guardian added properly on the student record afterwards.
