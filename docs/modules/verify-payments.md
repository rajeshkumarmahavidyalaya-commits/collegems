# Payments from families, transport invoices, bulk printing

The reference's Verify Payments, the payment methods it shows families, its
Transport Invoices screen and Print Invoices in Bulk. Migrations `0353` and
`0354`.

## A family pays by bank or UPI

1. **The college says where to pay.** `fees.payment_methods` is a setting
   (Settings, Fees tab): account holder, bank, account number, IFSC, branch,
   UPI ID and a note. Settings are readable by every member of the college,
   which is right here, since these details exist to be given to families.
   Nothing secret goes in it. Leaving both the account number and the UPI ID
   empty switches the feature off, and a family is told to pay at the counter.
2. **The family pays and says so** (`/family/pay`, *Pay Online*). The page
   shows the bank details and a UPI QR code per open invoice. The code is
   NPCI's `upi://pay` link with the amount and the invoice number, drawn on the
   server. The family sends the amount, the method, the bank's reference (UTR),
   the date and an optional screenshot.
3. **The office checks the bank and decides** (`/fees/verify`, *Verify
   Payments*). Approving writes an ordinary receipt and tells the family;
   turning one down needs a reason, which the family reads.

**A claim is not money.** Nothing reaches the ledger until the office
approves. Approval calls `fees_record_payment`, the one definition of a
payment (rule 6), as the caller, so the ledger's own insert policy is what
admits the receipt.

## The rules, and where each is enforced

- **A family has no write policy on `payment_claims`.**
  `payment_claim_submit` is a definer and checks:
  - the child is theirs;
  - the invoice is the child's and still issued;
  - the college takes these payments;
  - the date is within the last year and not in the future;
  - a screenshot sits in the child's own folder;
  - the reference has not already been sent;
  - fewer than ten of the child's claims are waiting.
- **The same reference is one payment.** A partial unique index on the
  lower-cased reference, ignoring rejected claims, so a corrected claim can be
  sent with the same reference after a rejection.
- **The office decides through two INVOKER functions.** The update policy
  admits exactly the roles the ledger's own policies admit (admin,
  accountant), and only while the claim is pending. A column grant limits the
  update to the decision columns, so the amount, the reference and the proof
  stay as the family sent them. Probed: an administrator updating `amount`
  gets `permission denied`.
- **Approved means a receipt exists, and rejected means a reason exists.**
  Both are CHECKs, so neither can be set by hand without the other half.
  Probed: setting `status = 'approved'` directly fails
  `payment_claims_approved_chk`.
- **Approving twice takes the money once.** The claim's id is passed as the
  provider event id, which `fees_record_payment` is already idempotent on.
  The second call is refused anyway, with "already been approved".
- **The receipt is dated noon on the day the family paid, in the college's
  time zone**, and numbered in the year the invoice belongs to (0186).
- **A screenshot** is an object in `documents` under
  `<tenant>/payment-proofs/<student>/`. A storage policy lets families write
  there and nowhere else in that bucket. It is uploaded before the claim is
  written and removed if the claim is refused (rule 8's direction). The office
  opens it through a link signed only after the claim has been read back
  through RLS.

## Transport invoices

`report_transport_invoices` is a catalogue report (rule 11), linked from the
Transport page and gated on `fees.collect`. It returns one row per child with
a bus seat this year: route, stop, monthly fare, and the billing periods due
so far.

Transport is billed per instalment whose `collects` includes monthly (0317).
So each period the seat covers is one of:

- **paid**: its invoice nets to nothing after payments and concessions;
- **unpaid**;
- **not generated**: no invoice for the period carries the route's fee head.

Alongside the periods, the report gives the transport billed, the part still
on unpaid invoices, and the part **billed outside a period**.

That last column is `0354`. Run read-only against the demo college, the first
row read *"12 not generated"* beside *"4,800.00 billed"*. The college had set
up twelve monthly periods, run only September, and billed the bus as one lump
on an invoice outside any period. Both numbers were true, and together they
read as a contradiction until the third one was shown.

## Print invoices in bulk

`/fees/invoices/print` prints this year's bills for one class, filtered to
unpaid, paid, issued, cancelled or all, one bill to a sheet, in class and roll
order.

- The bills are the same documents the single invoice page prints:
  `getInvoiceDocuments` loads a class in one query per table, and the
  single-invoice page goes through it too.
- More than 200 bills is refused with the count rather than truncated
  (rule 13).

## Verified

In Northgate Test Annex, 7 Oct 2026:

- With the setting empty, the family page said to pay at the counter.
- The administrator saved bank and UPI details from Settings. The link from
  Verify Payments opens the Fees tab at that card.
- The student saw the bank details and a QR code for IN-2026-00001 at
  ₹1,000.00.
  - A two-letter reference was refused on the field.
  - A UPI payment with a screenshot was sent.
  - The same reference again was refused by name.
  - A ₹150 bank transfer was sent.
- The office saw both. It approved the UPI payment into a receipt and turned
  the transfer down with a reason. The student then saw *Approved* with a
  receipt link, *Turned down* with the reason, and the invoice gone from the
  open list.
- The proof's signed link returned the image (200, `image/png`), fetched from
  the shell. This sandbox's browser cannot reach the storage host directly, so
  the new tab itself was not seen.
- Bulk print for B.A. I Year · A, all statuses: three bills became three
  printed pages, with the menu and controls hidden. A teacher is refused both
  office screens in a sentence.
- In a rolled-back transaction:
  - a second child's account, a screenshot in another child's folder and a
    duplicate reference were each refused;
  - a family editing a claim touched 0 rows;
  - a teacher read 0 claims and could not reject one;
  - a rejection needs a reason, and a rejected reference can be sent again.
