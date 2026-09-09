# The staff directory — a projection, not a row

Migration `0193`.

## The comment that was two claims, both wrong

`public.staff` carried a SELECT policy giving every signed-in member of a
tenant the whole table, added in migration `0009` under this:

```sql
-- Staff directory (name/designation/department) is not sensitive HR data
-- and is needed by every role to render things like "Class teacher: ...".
create policy "tenant members view staff directory" on public.staff
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
```

Measured on the demo school, as a caller whose JWT says `role = parent`:

| | rows readable |
|---|---|
| `staff` | **15** |
| `people` | **0** |
| `staff` joined to a name | **0** |
| `timetable_entries` | 276 |

Both halves of the comment fail, in opposite directions.

**It grants more than it says.** A policy decides which *rows* a statement may
touch and has nothing to say about columns — the same sentence `CLAUDE.md`
already carries about UPDATE, which turns out to be about SELECT too. So the
grant was never "name, designation and department": it was `employee_code`,
`date_of_joining`, `status` and `date_of_leaving` as well. A family could read
that a member of staff is `terminated` and join it to the 276 timetable rows
they can also read to work out whose Monday period that was.

**And it delivers less than it says.** The name it exists to render lives on
`people`, which correctly denies parents and students. `timetable_for_section`
left-joins `people`, so a parent opening their child's timetable has been shown
a **blank** where the teacher's name goes — every day since the module shipped.

The policy granted exactly the employment facts the comment thought it was
excluding, and withheld the one thing it was written to provide.

## Why the fix is a function

`CLAUDE.md` prescribes a column-level `GRANT` beside the policy when only some
columns should be reachable. That works on `notification_deliveries` and
`certificates` because there the rule separates **rows** — nobody else had
UPDATE at all. It cannot work here:

> **A `GRANT` is role-wide.** Every user of this application — parent, teacher,
> administrator alike — is `authenticated`. `grant select (id, designation) on
> staff` would take `date_of_leaving` away from the payroll screen in the act of
> hiding it from a parent.

That is the fork `homework_submissions` reached, and it has the same answer: the
narrower party gets a `SECURITY DEFINER` function returning the projection, and
no policy at all.

```sql
create function public.staff_directory()
returns table (staff_id uuid, full_name text, designation text, department text)
security definer
```

Three columns, no employment facts, everybody on the staff of the caller's
tenant. **The definer is the mechanism**: it is what makes this a projection
rather than a view over a table the caller can read directly anyway.

Two details worth keeping:

- **Its `where tenant_id =` is mandatory**, and it is the only read model in the
  schema where that is true. Rule 11 forbids the filter because invoker + RLS is
  what stops a report crossing tenants; here no policy runs, so the predicate
  **is** the isolation. `tests/rls/tenant-isolation.test.ts` pins it beside the
  policies rather than in a module suite, and asserts in both directions *and*
  that an administrator's directory equals their own staff list — a definer
  function returning nothing at all would pass a one-sided check.
- **Departed staff are included, deliberately.** A name is needed to render
  records made before somebody left, and the row carries no fact about their
  employment. Filtering them out would put the leaving date back into the
  answer, in the shape of an absence.

## What changed for whom

The row policy was dropped; `staff roles view staff directory` (admin, teacher,
accountant, librarian) and `admins manage staff` are untouched. Probed as each
role afterwards, on the same section:

| role | `staff` rows | `staff_directory()` | lessons with a teacher's name |
|---|---|---|---|
| parent | 15 → **0** | 15 | 0 → **35** |
| student | 15 → **0** | 15 | 0 → **35** |
| teacher | 15 | 15 | 35 |
| admin | 15 | 15 | 35 |

Both halves of the bug, closed by one edit. A custom role a tenant adds later
falls through to `staff_directory()` and nothing else, which is the safer
default to fail into.

## An unlooked-for 11×

`timetable_for_section` and `hostel_for_student` now source the name from the
projection instead of left-joining `staff` and `people`. Timed as the caller,
ten calls each, on a 35-lesson section:

| caller | old (`staff` + `people` joins) | new (`staff_directory()`) |
|---|---|---|
| teacher | 56.9 ms | **3.9 ms** |
| admin | 42.2 ms | **3.7 ms** |

The cost was policy evaluation, not rows — `people` carries six permissive
policies, and a teacher's is an `EXISTS` across students, enrolments, sections
and user_profiles. The definer skips all of it. This is the same finding as
`checks_run()`'s 35×, arriving from the other direction: there the fix was to
ask the expensive question once, here it is that the question did not need
asking at all.

`exams_report_cards` was deliberately **not** changed. It is run by staff to
produce a document, and rule 12 freezes a document when it is made — so the name
on a card comes from the run, not from a family's read.

## Not built

**The staff module itself.** There is still no `/staff` screen: no roster, no
way to add a member of staff, and no surface for `staff_exit` — which means the
guards migration `0191` put on `timetable_set_entry` and `substitution_arrange`
protect against a status nobody can currently set through the app. That is the
next piece, and it is the same criticism rule 6 makes of a correct write path
nobody can call.
