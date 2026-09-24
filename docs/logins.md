# Who signs in, and what each login is for

SchoolOS has two separate ladders, and mixing them up is the most common
question about logins.

## Inside one college

```
Super admin            roles.code = 'admin', tier = principal
│  The college owner or principal. Every permission; the only seat that can
│  open elective choices, invite people, edit what each role may do, and ask
│  the assistant about the whole college.
│
├── Staff              tier = staff
│   ├── Teacher        registers, marks, homework, their own class
│   ├── Librarian      the library counter and catalogue
│   └── Accountant     the fee counter, invoices, student types
│
└── Families           tier = student
    ├── Student        their own record, subjects, results, fees
    └── Parent         their own children only
```

- **"Super admin" is a display name.** The role's code is still `admin`,
  because sixty RLS policies compare that code (CLAUDE.md rule 3, *the code is
  deliberately not renamed*). Renaming the display name is a row in `roles`
  and changes nothing about access.
- **A tier decides what a person is shown; the matrix decides what they may
  do.** A college can grant a teacher `fees.collect` from
  `/settings/permissions` and the fee counter appears for them the same day.
- **Every login is tied to a record.** A teacher's login points at their staff
  row, a student's at their student row, a parent's at their guardian row.
  That link is what RLS reads: a student login with no student record sees
  nothing, which is the correct failure.

## Above all colleges: the platform operator

A **platform operator** runs SchoolOS itself and has **no college**. They see
`/platform` (colleges, plans, usage counts) and no student, fee or mark in any
college — rule 1's boundary holds for them too. A platform operator is not a
super admin, and a super admin is not a platform operator. See
`docs/modules/platform.md`.

## Creating logins

The ordinary path is **Settings → Team → Invite**: pick the role, pick the
person the login is for, send. The person signs up with the invited email and
lands in the college with the right role. For a whole class of families, use
the bulk invitation on the same screen.

Demo logins for the live college were created directly in the database for
first use. **Their passwords are not in this repository** and were handed over
once; change each one after the first sign-in.

## Before a college goes live

A new college's super admin sees a **Get your college ready** checklist on the
home page until the basics are done: school details, classes, subjects, the
roll, fees, staff logins and family logins.

- Change every demo password, and remove demo logins nobody will use.
- Rotate the assistant's model key if it was ever pasted anywhere, and set it
  as the `GEMINI_API_KEY` secret on the `assistant` Edge Function (the Vault
  copy is the fallback). See `docs/modules/assistant.md`.
- Fill in the school profile (`/settings/school`) — certificates print from it.
- Check `/checks`: every finding there is something a person has to act on.
