# Schools: one login, several colleges (0323)

The reference (Weblizar School Management) opens on **School Management >
Dashboard**: a card per school, the current one highlighted, and choosing a
card makes it the school every other screen works in. Its **Schools** page is
a table (School Name, Phone, Email, Address, Number of Classes, Admins,
Status, Action) with **Add New School**.

## Who chooses

**Only the super admin (0325)**: a login whose role holds `users.manage` in
the college, the same seat that may add a school. `my_schools` lists only the
colleges the caller administers and `school_switch` refuses any other, so a
teacher, accountant, librarian, parent or student never sees the picker: they
land on their school's dashboard, the school's name in the band is plain text,
and `/schools` tells them choosing is the super admin's. Probed: the Northgate
administrator lists Northgate Academy and Northgate Test Annex and switches;
the Northgate teacher lists none and is refused.

## What a login may see

Only the colleges it belongs to and administers. The platform owner does not see every
customer's college here; that is the operator console's job, and it never
shows a child, a family, money or marks (0209). Chosen by the product owner on
3 Oct 2026 as "Schools you belong to".

## How it works

| Piece | What it does |
|---|---|
| `school_memberships` | One row per (college, login): role, and the person, student, staff or guardian record it acts as there. Read-only to JWT roles; every write is a definer. |
| `user_profiles` | Still one row per login: the **active** membership. A trigger keeps the active membership in step with every writer of the profile. |
| `school_switch(college)` | Refuses a college the caller does not belong to or was switched off in (one sentence for both), then copies the membership into the profile and the token's `tenant_id` and `role`. The app refreshes the session. |
| `my_schools()` | The caller's colleges: name, phone, email, address (from `school.profile`), their role, plan status, current or not, and class and admin counts only where they administer it. Definer filtered by `auth.uid()`. |
| `school_add(...)` | Add New School: needs `users.manage` in the current college, refuses an operator, at most ten colleges per login. The caller becomes the new college's administrator and stays where they are. |
| `college_create(...)` | What every new college is given; called by `school_add` and `platform_start_school`. |
| `team_set_access`, `team_set_role` | The team screen's doors. Switching somebody off who belongs to another active college does not ban them; if this was their active college their profile moves to the other. Only a login with no other active college is banned and signed out (0289's full close). |

## Screens

- `/schools`: the card dashboard. The first page after signing in for an
  administrator, or for anybody who belongs to more than one college.
  Everybody else lands on their college's dashboard.
- `/schools/manage`: the Schools table, with Open on each row.
- `/schools/new`: Add New School, the sign-up form's fields through the same
  component, drawn only for `users.manage`.
- The school's name in the band links to `/schools`.

## Verified

Probed in rolled-back transactions on 3 Oct 2026:

- add a school, list two, switch: profile and token move, the new college's
  roll is empty, its team screen lists one;
- switching into the other customer's college is refused;
- Northgate's second administrator switching the owner off while the owner
  works elsewhere: no ban, membership off, switching back refused;
- switching off while the owner works in Northgate: profile and token move to
  the other college, no ban; switching back on restores the membership;
- a teacher with one college switched off is banned, as 0289 does; switched
  back on, unbanned;
- the old doors return 42501 to a JWT role; a teacher cannot add a school.

In the browser on Northgate: the administrator lands on `/schools`, adds
"Northgate Test Annex", switches to it (band, roll and team change), and back;
a teacher lands on `/`, sees one card, and is told they cannot add a school.
No horizontal scroll at 375 px.

**Left in the database:** the college "Northgate Test Annex" (`northgate-test-annex`), created by the walkthrough through the real Add New School and
belonging to the Northgate test administrator. Its first year is named
"2026-2026" because it was founded before `0324` fixed the naming; rename it on
its Academic years screen.

## Starting from zero

1. **Sign in page → "Create an account and start your college"** (`/signup`):
   email and password.
2. **Confirmation email.** Sign-ups are enabled on the Supabase project and
   "Confirm email" is on, so the account is usable only after the link is
   clicked. The link returns through `/auth/callback?next=/start`, which sets
   the session.
3. **`/start`**: the college's name, web address and time zone.
   `platform_start_school` founds it through `college_create`, makes the
   person its administrator, and the session is refreshed.
4. **`/schools`**: School Management with the new college as the first card.
   Add New School founds the next one under the same login.

Probed in a rolled-back transaction with a brand-new confirmed login and no
invitation: no profile and an empty picker before; one card, current, as
administrator, year named "2026" after founding; two cards after Add New
School. The sign-in link, the sign-up form and the guard on `/start` were
checked in the browser. **Not checked: the confirmation email reaching an
outside address**, which depends on the project's SMTP settings (below).

**Email delivery is a setting, not code.** Supabase's built-in mailer delivers
only to the project's own team addresses and is heavily rate-limited, so a
stranger signing up would never receive the link. Before opening sign-up to the
public, set a custom SMTP server in Supabase (Authentication → Emails → SMTP
Settings), for example Resend, which `notify-dispatch` already uses. Turning
"Confirm email" off would avoid the email but lets anybody claim any address.

## Not done

- Inviting a login that already exists into a second college. Invitations still
  resolve at sign-up; a second college is reached by the administrator adding it.
- The reference's photo and logo on each card; a college's logo is not stored.
