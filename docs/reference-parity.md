# Reference parity, function by function

Walked on 6 Oct 2026, read-only, against the public demo of the Weblizar
School Management plugin (wpschool.weblizar.com):

- the nine public front pages;
- the demo accounts for teacher, accountant, receptionist, librarian, student
  and parent, each signed in through the demo's own button;
- the super admin's 95 back-office pages, in `docs/reference-inventory.md`
  from 3 Oct.

Only GET requests left the browser, apart from the demo sign-in. Any address
naming a delete, send, approve, import, print, pay or similar action was
blocked. No reference record, name or image was copied: this lists functions,
not data.

**Have** means the function exists here and was checked. **Partial** says
what is missing. **Missing** is not built. **Not adopted** is a deliberate
difference, with the reason.

## 1. The public site

| Reference page | Here | Status |
|---|---|---|
| Online Admission (school pick, personal, previous school, admission, parents, logins, transport, survey, fees) | `/apply/[slug]` (`admission_apply`, 0268), off by default per college | **Partial**: no previous school, mother tongue, birth place, PEN/APAAR, category or document uploads; no logins made from the public form (an invitation follows approval) |
| Staff Registration | none | **Missing**: a public application, approved into staff by the office |
| Student Certificate (school, certificate, enrollment number) | none | **Missing**: public verification of an issued certificate |
| Fee Submission (find a student, pay) | family login, `/fees/family`, Razorpay link | **Not adopted** as an anonymous page: a fee balance found by admission number tells anybody what a family owes. A family pays signed in |
| Student Invoice | family login | **Not adopted**, for the same reason |
| Admission Inquiry | `/front-office` (office enters it) | **Missing**: a public enquiry form |
| Exam Time Table | `/exams/[id]` (signed in) | **Missing**: a public timetable for a published exam |
| Exam Admit Cards (exam, roll number) | `/exams/admit-cards` (office), family view | **Partial**: no public lookup |
| Exam Results (exam, roll number) | `/report-card` (family) | **Partial**: no public lookup |

## 2. Student and parent portal

The reference gives a family a separate Student or Parent Dashboard, with a
child picker for a parent. Until 0346 a family signed in to the staff
dashboard with their own rows in it: "Students with Dues: 1" was their own
child, the defect `docs/modules/reports.md` describes for reports. Built on
6 Oct 2026; see `docs/modules/family.md`.

| Reference section | Here | Status |
|---|---|---|
| Dashboard: profile card, session fee summary, attendance by status, transport, latest notices, calendar | `/` for a family login (0346) | **Have** |
| Fee Invoices (select and Pay Selected) | `/fees/family`, `/fees/students/[id]` | **Have** (pay one link at a time) |
| Fee Structure (fee type, amount, period, occurrences, session total) | `/family/fee-structure` | **Have** |
| Payment History (receipt, print) | `/family/payments` | **Have** |
| Study Materials | `/study-material` | **Have** |
| Lessons (by subject, searchable) | none | **Missing** (see 5) |
| Homework | `/homework` | **Have** |
| Noticeboard, Calendar, Events | `/notices`, `/calendar`, `/events` | **Have** |
| Class Time Table | `/timetable` | **Have** |
| Live Classes | `/live-classes` | **Have** |
| Books Issued | `/family/books` | **Have** (a parent could not read the loans before 0346) |
| Exams Time Table, Admit Card, Exam Results | `/family/exams`, `/family/admit-card`, `/report-card` | **Have** |
| Certificates | `/family/certificates` | **Have** |
| Attendance (month, subject; totals) | `/family/attendance` | **Partial**: by month; not yet by subject |
| Leave Request | `/attendance/leave` | **Have** |
| Tickets | none | **Missing** (see 5) |
| Stationary Issued | `/family/stationery` | **Have** |
| Chat (message a teacher) | none | **Missing** (see 5) |
| Account Settings (contact details, password) | `/family/profile` | **Have**: phone and address, a parent's own phone and occupation, password; not the name or email |

## 3. Staff portal (teacher, accountant, receptionist, librarian)

| Reference | Here | Status |
|---|---|---|
| Staff Dashboard: Clock In / Clock Out, monthly history, My Profile | `/hr` register (office, readers) | **Missing**: self clock-in, off by default |
| Leave Request | `/hr/leave` | **Have** |
| Receptionist role | six roles, matrix per college | **Partial**: no custom roles (see 6) |

## 4. Back office: modules that exist here

Have, with the screens matched on 3-6 Oct: schools, sessions, class groups,
classes and sections, setup wizard, mediums, houses, student types,
subjects, class timetable, staff timetable, attendance (take, report, by
subject), student leaves, study materials, homework, noticeboard, events,
calendar, holidays, live classes, staff rating, birthdays, inquiries,
students, ID cards, promotion, certificates, notifications, admins,
permissions, staff, staff attendance, staff leave, staff ID cards, payroll,
fee types, concessions, invoices, collect payment, payment history,
donation, expenses, exams, exam groups, admit cards, results, report cards,
books, books issued, library cards, vehicles, routes, hostels, rooms,
stationery items and issue, gate passes, reports, audit trail (Logs).

Partial inside them:

| Reference function | Status |
|---|---|
| Subjects: Subject Types, subject image, Assign Subject in Bulk | **Missing**: types are theory/practical only |
| Pre-Admissions list | **Have** as online applications on `/front-office` |
| Attendance: QR Attendance | **Missing**: `/scan` opens a record, it does not mark a register |
| Attendance: Webcam (face) Attendance | **Not adopted**: face recognition is biometric data of children; readers (0273) cover the device case |
| ID Card Layouts (name, orientation, background, visible fields) | **Missing** |
| Transfer Student to another school | **Missing**: memberships (0323) make it possible |
| Verify Payments (a family's bank or UPI payment with a proof, approved by the office) | **Missing** |
| Payment methods shown to families (bank details, UPI ID and QR) | **Missing** |
| Transport Invoices (per child: route, fare a month, paid, unpaid, not generated) | **Missing** as a screen; billing exists |
| Print Invoices in Bulk (class, section, status) | **Missing**: one invoice at a time |
| Academic Reports and Multi Group Reports (consolidated across exams) | **Missing** (backlog #10) |
| Reports: Enrollment (gender, admission date range) | **Partial**: Class roster lacks those filters |
| Admission form: category, mother tongue, birth place, PEN, APAAR, previous school, parents' occupation and ID | **Partial**: occupation is stored on the guardian; the rest is missing |
| Settings: email/SMS templates per event | **Partial**: templates exist, no editor for every event |
| Settings: SMTP and SMS carrier credentials in a form | **Not adopted**: a credential in settings is readable by every member (rule 12); provider keys are Edge Function secrets |
| Settings: currency | **Not adopted**: the rupee is a fact about the money (rule 15) |
| Settings: delete data on uninstall, logs retention, redirect after logout | **Not adopted**: WordPress plugin concerns |

## 5. Back office: modules not built

| Reference module | Columns and form | Status |
|---|---|---|
| Activities | Name, Class, Fee, Description, Status | **Missing** |
| Lessons and Chapters | Chapter: Title, Class, Subject. Lesson: Title, Class, Subject, Chapter, link (none, attachment, URL), Description | **Missing** |
| Tickets | Title, Priority, Status, Subject, Student, Class, Role, Assigned To, Due Date | **Missing** |
| Chat | direct or named group by class and section; a student messages a teacher | **Missing** |

## 6. Roles

The reference lets a school add roles (Receptionist). Here a college has six
roles with an editable permission matrix, and RLS policies compare the role
**code**: a new code would match no policy and see nothing. A custom role is
therefore not a row; it needs every policy that names a role reviewed.
**Not adopted** in this pass, and named here so it is not forgotten.

## Order of work

1. ~~Family dashboard and portal pages~~ (0346, 6 Oct 2026).
2. Lessons and chapters; subject types and bulk assignment.
3. Tickets; activities.
4. Chat.
5. Fees: verify payments, payment methods for families, transport invoices,
   bulk invoice print.
6. Public pages: enquiry, certificate verification, exam timetable, staff
   application, result and admit card lookup.
7. ID card layouts, QR attendance, staff clock-in, transfer between schools.
8. Admission fields; enrollment report filters; consolidated academic
   reports.
