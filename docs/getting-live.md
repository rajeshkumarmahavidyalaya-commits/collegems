# Getting the live college working — the steps only a person can take

Written on 1 October 2026 from the live database. Everything below is either a
decision the college has to make or a secret only the project owner can set;
none of it can be done from code. The home page's *Get your college ready*
checklist tracks the first three (it said "everything is set up" until 0310
made it check what is true).

## 1. Move the college into 2026-27 (the most urgent)

The current year is still **2025-2026, which ended on 31 March 2026**. Every
register, invoice and ledger entry since April has been filed under it (the
*Checks* page lists them). In this order:

1. **Promote** (*Promotion*): run a promotion from 2025-2026 into 2026-2027.
   The preview is editable rows; correct the children the rules get wrong, then
   apply. This creates each child's 2026-27 enrolment.
2. **Renew transport and hostel** (*Promotion → Renewals*): 46 bus seats and
   13 hostel beds end with 2025-2026.
3. **Copy fees** into 2026-27 if the year-end checklist says they are missing.
4. **Switch the year** (*Academics → Years*): make 2026-2027 current. It is the
   last step on purpose, and it asks you to confirm.

Rows already filed under the old year are named by *Checks → Rows filed under
the wrong year*. They are not moved automatically, because moving a register
row to a year the child was not enrolled in would be wrong in a different way;
the promotion is what makes them consistent.

## 2. Rudra Rai's classes

Rudra Rai is marked as having left but still holds 19 timetable lessons, is
class teacher of 2 sections and has 6 subject assignments. Give each to another
teacher (*Timetable*, *Academics → Classes*), or the cover roster will keep
showing those classes as having nobody.

## 3. Connect email and SMS

Nothing has ever been emailed or texted from this product: no provider is
connected. These are **Supabase Edge Function secrets** (Project → Edge
Functions → Secrets), not settings in the app:

| for | secrets |
|---|---|
| email (Resend) | `RESEND_API_KEY` — then set the from-address under *Notifications → Channels* |
| SMS (Twilio) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| SMS (MSG91, India) | `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY` — and register DLT templates (*Settings → SMS registration*) |
| delivery reports | `NOTIFY_RECEIPTS_URL` (the `notify-receipts` function's URL, on both `notify-dispatch` and `notify-receipts`), `RESEND_WEBHOOK_SECRET`, `MSG91_RECEIPT_TOKEN` |
| WhatsApp | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |
| push | `FCM_SERVICE_ACCOUNT` (the Firebase service-account JSON) |

Then switch the channel on under *Notifications → Channels*. One invitation
email has been waiting in the queue since it was created; it goes out the
first time the dispatcher runs with email connected.

## 4. Invite the families

301 of 302 children have nobody who can sign in. Once email or SMS works:
*Settings → Team → Invite a class*. The report *Families who cannot sign in*
says, per child, what is in the way (no guardian, no address, not invited).

## 5. Things only the project owner can set

- **CI database tests.** GitHub → Settings → Secrets → Actions: the six
  `TEST_*` values from `.env.example`. Until then the `database-suites` job
  fails on purpose, because skipping the isolation tests is not passing them.
- **Leaked-password protection.** Supabase → Authentication → Policies →
  *Prevent use of leaked passwords*. A dashboard switch; nothing in a migration
  can turn it on.
- **Platform billing.** `PLATFORM_RAZORPAY_KEY_ID`, `_KEY_SECRET` and
  `_WEBHOOK_SECRET` on the two `platform-subscription-*` functions (deployed on
  1 Oct 2026, refusing every request until then), and each plan's
  `provider_plan_id` (see `docs/modules/billing.md`).

## What is deliberately left as it is

- **`btree_gist` in `public`.** The advisor suggests moving it. The exclusion
  constraints that stop two bookings overlapping are built on its operator
  classes; moving the extension means rebuilding every one of them for a
  warning about schema tidiness, not about access.
- **"Signed-in users can execute SECURITY DEFINER function"** (about 56
  lines). Each of those functions checks who is calling inside its own body —
  that is the shape rule 4 prescribes — and `definer_guard_violations()` is
  the check that matters here; it is 0.
