# Tickets and activities (0348, 0349)

The reference's SM Tickets and SM Activities.

## Tickets

A ticket is something to be done about a student, with a priority, a status,
who it is assigned to and by when. `/tickets` is one address with two screens,
chosen by the tier (which decides only what is shown):

- **Tickets Management** for staff. The administrator creates and edits through
  the policy. The person a ticket is assigned to changes its status through
  `ticket_set_status`, a narrow definer, and has **no update policy**: RLS
  cannot limit an assignee to the status column, and an update policy would
  let them reassign the ticket or rewrite it.
- **Support Tickets** for a family: their child's tickets, whoever raised
  them, with the college's note, and a form to raise one (`ticket_raise`,
  definer, own child only; no family insert policy).

The class is frozen when the ticket is raised: a ticket records a day, not
"now". `tickets_resolved_chk` keeps `resolved_at` in step with the status.

## Activities

An activity has a name, the class it is for (or every class), a fee, a
description and a status.

- **Joining raises the fee** through `fees_raise_charge`, the counter's own
  charge, so it is billed, paid and receipted like any other (rule 6). A
  student already on the activity is not charged twice.
- **Withdrawing is one act**: the row is ended, never removed, and its invoice
  is cancelled through `fees_cancel_invoice`. If money was taken against the
  invoice, that function refuses and says what to reverse first, and the
  withdrawal fails with its sentence.
- A fee needs a fee type (`activities_fee_head_chk`), so the invoice line
  says what it is for.

## promotion_undo (0349)

The undo sweep named `tickets` on its first run. A ticket carries a student
and a year, so an undo now refuses while one was raised in the new year about
a child the run moved. 0349 is 0345's definition with one row added; it
contains DELETE statements, so it is run in the SQL editor.

## Checked

Probed (rolled back) as the Annex administrator, teacher and student:

- a fee without a fee type was refused;
- joining raised one invoice, and joining again did not raise another;
- withdrawing cancelled the invoice;
- a teacher putting a student on an activity was refused;
- the teacher read only their own ticket, resolved it, and could not reassign
  it (0 rows);
- the student read their child's ticket, raised one, could not raise one for
  another child, and could not close their own.

Walked in the browser:

- the administrator added "Annex Music Club" at ₹250. Adding Walk Thirtyone
  raised IN-2026-00004; taking them off cancelled it, and the row stayed,
  marked withdrawn.
- the administrator created a ticket assigned to the Annex teacher. The
  teacher saw it without a Create button and resolved it with a note.
- the student saw the ticket and the college's note, and raised their own.
