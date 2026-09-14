# Invitations — naming the person a login is for

**Migrations** `0224` (`roles.subject`, the composite key, `invite_candidates`,
the critic), `0225` (the trigger that fills the carried column), `0226` (number
agreement). **Screen** `/settings/team`. **Permission** `users.manage`.
**Guard** `tests/settings/invitations.test.ts`.

---

## The gap

`0221` made 555 guardians writable. This is the question one step along, and the
answer measured on the demo college was stark:

| | |
|---|---|
| guardians | **555** |
| guardian logins | **0** |
| student logins | **0** |
| logins in total | 2, both administrators |
| notification deliveries | 2, ever |
| registered devices | 0 |

**The database had been ready since `0004`.** `invitations` carries `person_id`,
`student_id`, `staff_id` *and* `guardian_id`; `handle_new_auth_user` resolves all
four and stamps them onto `user_profiles`; the server action accepted all three
ids and inserted them.

`team-view.tsx` mentioned `guardianId` **zero times**. It sent an email address
and a role.

So an administrator inviting somebody as *Parent* created a login with
`guardian_id = null` — and the policies are not ambiguous about what that means:

```
parents view own children   ... up.guardian_id = gs.guardian_id
students view self          ... id = up.student_id
teachers view own section   ... up.staff_id = s.class_teacher_staff_id
```

Null on either side and the policy matches nothing. The family signs in, every
query is correct, and every answer is nothing. `0205`'s lesson one layer along:
*a JWT minted before a tenant existed does not have one*, and a profile minted
without a guardian is not one.

**Read the other way, the policies also say why it stayed invisible.**
`admins manage students` and `staff roles view students` compare the role code
alone, so an administrator works with nothing attached. The only seats that
break are the ones nobody in this codebase had ever signed into.

## What a role stands for is a column, not a branch

`roles.tier` (migration `0208`) groups the picker and cannot answer this:
`parent` and `student` share the `student` tier and need *different* records. A
`case role.code` in TypeScript would be this product's six roles hardcoded —
exactly what `0208` refused for the tier.

`roles.subject` — `staff | student | guardian | none` — carries the same warning
as its neighbour:

> **A subject decides what an invitation must name. It never decides what the
> holder may do.** That stays `role_permissions`, editable per college.

`admin` is `staff` rather than `none`: a principal is employed by the school, and
letting their login attach to nothing is how *"my pay"* and *"my leave"* quietly
return nothing for the one person who would never think to report it. The
founding principal is unaffected — `platform_start_school` writes
`user_profiles` directly and touches `invitations` not at all (checked, not
assumed).

## The composite-key device's sixth use, carrying a *requirement*

A CHECK cannot reach `roles`, so:

```sql
invitations (tenant_id, role_id, role_subject)
  -> roles  (tenant_id, id,      subject)      on update cascade
```

One key does three things:

- `role_subject` is held equal to the role's own, so the CHECK can ask about
  `roles` without joining to it;
- `tenant_id` in the key closes a hole nobody had noticed —
  `invitations_role_id_fkey` referenced `roles(id)` alone, so an invitation
  could name **another college's role**. Not a leak: the tenant in the JWT comes
  from `inv.tenant_id`, and a foreign role code absent from this college's
  matrix is refused everywhere by `role_has_permission`. It fails closed. It is
  closed here because the device needed the key anyway;
- `on update cascade` means changing what a role stands for rewrites its
  invitations and re-evaluates the CHECK.

**The CHECK applies while the row is still a promise** — `status <> 'pending'`
exempts accepted and revoked rows. That is load-bearing in both directions:
history is not rewritten by a decision taken today, and changing a role's
subject is refused only while *pending* invitations contradict it, which is
recoverable by revoking them rather than by a constraint error on a row from two
years ago.

### …and a carried column needs a writer

`0224` shipped the key without one, and the probe meant to demonstrate it
refused a **correct** insert:

```
insert into invitations (tenant_id, email, role_id, guardian_id)
  values (..., <the Parent role>, <a guardian>)
-> 23514  invitations_subject_present
```

`role_subject` defaults to `'none'`, so an insert that does not mention it says
*this role stands for nobody* about a role that stands for a guardian.

> **A carried column is a copy, and a copy needs somebody to write it.** In the
> device's five earlier uses the child carries either a constant the writer
> already knows (`slot_schedulable` is always `true`) or a value it is holding
> anyway (`marks.max_marks`). This one is neither: it is a fact about the
> *parent row*.

Making every caller look it up is a second copy of the rule in every writer, and
**a plain insert through PostgREST routes around any function** (`0205`), so it
cannot live in a write function either. `0225` is a `BEFORE INSERT OR UPDATE`
trigger, and the split of responsibility is the point: the trigger **populates**,
the key and the CHECK **enforce**. A trigger dropped by a later migration makes
writes fail rather than letting a wrong value through — which is what keeps this
consistent with rule 4 rather than an exception to it.

It also buys a readable refusal for the cross-tenant case: the composite key
answers a foreign role with an error naming three columns; the trigger gets
there first and says *"That role does not belong to this school."*

## One field, not three

`inviteSchema` takes a single `subjectId`. **The role decides which column it
lands in**, server-side — so the client cannot put a student's id into
`guardian_id`, and there is no three-way "exactly one of these" rule in the
browser to get wrong. The action reads the role's subject from the database
first, so a missing choice is a sentence (*"Whose parent or guardian is this
login for?"*) rather than `23514`: a control that will refuse you is worse than
no control.

`invite_candidates(subject, query)` is one read model for all three kinds —
three server-side searches would be three places to forget the permission check.
`SECURITY INVOKER` so RLS decides, **and** gated on `users.manage` inside
besides, because reading `people` is tenant-wide for every staff role and the
policy alone would let a librarian enumerate the roll through a picker.

`has_login` is the half a person actually needs. Inviting somebody who already
signed in is the common mistake and it is silent — the second invitation
supersedes the first and nothing looks wrong — so it is a warning beside the
name rather than a refusal: a second login for one guardian is a decision a
school is allowed to make.

## Probed end to end, from a seat nobody had used

In a rolled-back transaction: the office invites, the person signs up (which
fires the real `handle_new_auth_user` trigger), and then the product is read as
them.

| step | result |
|---|---|
| the office invites | Yash Bansal, guardian of Dhruv Bansal |
| they sign up | role `parent`, `guardian_id` set |
| JWT stamped | `parent`, tenant `2d15d1fc` |
| the invitation | `accepted` |
| their children | **1** |
| named | Dhruv Bansal (father, Grade 1 A) |
| fee account | charged 15,900.00 − discounts 2,880.00 − paid 11,520.00 = **due 1,500.00** |
| `students` readable | **1 row**, of 302 |
| `notices` readable | 1 |
| `timetable_entries` readable | 276 |
| `staff` readable | **0** (migration `0183` dropped that policy) |
| `audit_log` readable | **0** |

And the constraint, probed the same way: a Parent invitation naming nobody is
`23514`; naming a *student* is `23514`; naming a guardian succeeds with
`role_subject` filled in as `guardian`; a teacher invitation naming staff
succeeds; another college's role is refused in a sentence.

## The critic

`family_login_problems()` — catalogued as `users.family_logins`, so it is
reachable from `/checks` rather than from one screen. On the demo college:

> **302 of 302 active students have nobody who can sign in: no fee account,
> timetable, result or absence notice reaches their families.**

The count is of **children whose whole family cannot sign in**, not of
guardians, because the family is the unit a school thinks in and one parent with
a login is enough. Silent once every family has one.

### …and it shipped the grammar error CLAUDE.md warns about

The first version ended *"reaches those family."* Subject agreed, verb agreed,
last noun did not — `0196`'s lesson, written by somebody who had read the
paragraph about it, which is the useful part: the rule is easy to half-apply
because the first two agreements are the ones you are looking at while you write
the `case`.

`0226` also fixed an agreement the first draft had not noticed at all: there are
**two counts in one sentence**, and the noun agrees with the total while the verb
agrees with the numerator.

```
  1 of 302 active students has  ...
302 of 302 active students have ...
  1 of 1   active student  has  ...
```

Both forms are carried rather than derived, because English plurals are not
derivable and *family/families* is exactly the pair that proves it.

## What it cost

| `/settings/team` | First Load JS |
|---|---|
| before | 149 kB |
| with the picker importing `platform.ts` | **176 kB** |
| after splitting the prompts out | **150 kB** |

Twenty-six of those twenty-seven kilobytes were **Zod**, pulled in because
`SUBJECT_PROMPT` lived beside `inviteSchema`. That is `fees-display.ts`'s split
made a second time, and CLAUDE.md already warns about it in the words that now
head `invitations-display.ts`: *one `import { z }` and it silently becomes the
thing it was extracted from.* The whole picker costs **1 kB**.

## What it deliberately does not do

- **No email is sent.** An invitation is a row; `handle_new_auth_user` resolves
  it on signup. Sending the address a link is the notifications module's job and
  needs a decision about which channel a not-yet-user can be reached on.
- **A guardian may be invited twice.** Two logins for one guardian is a real
  arrangement — two parents sharing one guardian record is not — so the screen
  warns and does not refuse.
- **`person_id` is not offered.** It is the fourth column
  `handle_new_auth_user` resolves and there is no role that stands for a bare
  person; adding one to the picker would be a fourth kind with no caller.
