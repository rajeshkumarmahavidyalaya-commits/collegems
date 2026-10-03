# The reference, page by page

Read from the public demo of the Weblizar School Management plugin
(wpschool.weblizar.com) on 3 Oct 2026, signed in through its own "Super Admin
Log in" demo button. This is a specification of **structure**: page titles,
header buttons, table columns and form field labels. No record, option list,
name or image from the demo was copied, and nothing on the demo was changed:
the browser sent GET requests only, apart from the demo's sign-in, and any
address naming a delete, reset, send, approve, import or similar action was
blocked before it left the browser.

Pages whose table rows load through POST came up empty, which does not
matter here: their column headings are in the page.

How each page maps onto this product is in `docs/reference-ui.md`.

## School Management

`page=school-management`


## Schools

`page=sm-schools`

- **Columns:** School Name, Phone, Email, Address, Number of Classes, Admins, Status, Action

## Sessions

`page=sm-sessions`

- **Columns:** Session, Start Date, End Date, Action

## Settings

`page=sm-settings`

- **Fields (wlsm-save-general-settings-form):** Set Active Session: [select]; Set Date Format: [select]; Attendance: [checkbox]; Disable Future Attendance [checkbox]; GDPR Compliance: [checkbox]; Enable GDPR Compliance for Forms [checkbox]; Google Play link show: [checkbox]; Enable Google Play link show on dashboard [checkbox]; Library Menu show: [checkbox]; Disable library Menu show on dashboard [checkbox]; Examination Menu show: [checkbox]; Disable examination Menu show on dashboard [checkbox]; Transport Menu show: [checkbox]; Disable transport Menu show on dashboard [checkbox]; Hostel Menu show: [checkbox]; Disable hostel Menu show on dashboard [checkbox]; Activities Menu show: [checkbox]; Disable activities Menu show on dashboard [checkbox]; Lessons Menu show: [checkbox]; Disable lessons Menu show on dashboard [checkbox]; Tickets Menu show: [checkbox]; Disable tickets Menu show on dashboard [checkbox]; Accounting Menu show: [checkbox]; Disable accounting Menu show on dashboard [checkbox]; GDPR Compliance Text for Inquiry Form: [textarea]; GDPR Compliance Text for Registration Form: [textarea]
  - submit: Save
- **Fields (wlsm-save-appearance-settings-form):** Enable Color Scheme: [checkbox]; Enable custom color scheme [checkbox]; Color Scheme: [select]
  - submit: Save
- **Fields (wlsm-save-uninstall-settings-form):** Delete Data On Uninstall: [checkbox]; Delete database tables and settings when you delete the plugin? [checkbox]
  - submit: Save
  - submit: Generate
  - submit: Clean Up
- **Fields (wlsm-save-device-api-settings-form):** Scan Cooldown (Minutes): [number]
  - submit: Save Settings

## SM School — School Dashboard

`page=sm-staff-dashboard`

- **Buttons:** Add Class, Manage Sections, Assign Admins
- **Columns:** Class, Name, Phone, Email, Message, Date, Follow Up Date
- **Columns:** Student Name, Enrollment Number, Class, Section, Admission Number, Admission Date

## Class Groups

`page=sm-staff-category`

- **Columns:** Class Group Name, Classes, Head of Group, Action

## Classes

`page=sm-staff-school-classes`

- **Columns:** Class Name, Action

## Manage Classes — Classes and Sections

`page=sm-staff-classes`

- **Columns:** Class Name, Class Group, Number of Sections, Total Students, Head of Group

## Settings

`page=sm-staff-settings`

- **Fields (wlsm-save-school-general-settings-form):** Set Currency: [select]; Invoice Copy: [select]; Yes [radio]; No [radio]; Assign Fee Types on Promotion: [select]; Generate Invoices on Promotion: [select]; Generate Invoices Payment History: [select]; Show Session Fee Summary in Invoice; Registration Invoice Type; Combined Invoice [radio]; Separate Invoices [radio]; Auto Generate Invoice: [select]; Auto Generate Invoice Allow Partial Payment; Allow Staff to Edit "Authorized By" Field; Send Email or SMS Before Due Date: [select]; Send Email or SMS After Due Date: [select]; Upload School Logo: [file]; Choose File [file]; Upload School signature: [file]; Redirect URL after Logout: [text]; Google Application URL: [text]; Enable Face Login & Attendance
  - submit: Save
- **Fields (wlsm-save-school-email-carrier-settings-form):** Email Carrier: [select]; From Name: [text]; From Email: [email]; SMTP Host: [text]; SMTP Username: [text]; SMTP Password: [password]; SMTP Encryption: [text]; SMTP Port: [text]
  - submit: Save
- **Fields (wlsm-save-school-email-templates-settings-form):** Student Admission Email: [checkbox]; Enable [checkbox]; Email Subject: [text]; Email Body: [textarea]; Invoice Generated Email: [checkbox]; Online Fee Submission Email: [checkbox]; Offline Fee Submission Email: [checkbox]; Student Absent to Student Email: [checkbox]; Inquiry Received to Inquisitor Email: [checkbox]; Inquiry Received Notification to Admin Email: [checkbox]; Student Registration to Student Email: [checkbox]; Student Invoice Due Date Notification to Student Email: [checkbox]; Student Registration to Admin Email: [checkbox]; Exam Result Report Email: [checkbox]
  - submit: Save
- **Fields (wlsm-save-school-firebase-settings-form):** Firebase Configuration (JSON File): [file]; Choose File [file]; Remove uploaded JSON file [checkbox]; Enable Firebase Notifications: [checkbox]; Enable push notifications via Firebase [checkbox]
  - submit: Save Settings
- **Fields (wlsm-save-school-sms-carrier-settings-form):** SMS Carrier: [select]; SMS Package; Sender ID: [text]; Username: [text]; Password: [password]; API Key: [text]; Sender Name: [text]; Gwid ID: [text]; API ID: [text]; Line_number ID: [text]; SMS Type: [text]; PEID: [text]; Auth Key: [text]; Route ID: [text]; SMS Content Type: [text]; PEID or Entity id should be of 19 digit: [text]; Telemarketer id: [text]; Channel: [text]; Route: [text]; Peid: [text]; Authkey: [text]; Type: [text]; API Secret: [text]; From: [text]; SID: [text]; Auth Token: [text]; Sender: [text]
  - submit: Save
- **Fields (wlsm-save-school-sms-templates-settings-form):** Note: If you are using Template ID then use the templates text in message; Student Admission SMS: [checkbox]; Enable [checkbox]; Send To; Student [checkbox]; Father [checkbox]; Mother [checkbox]; SMS Message: [textarea]; Template ID: [textarea]; Invoice Generated SMS: [checkbox]; Online Fee Submission SMS: [checkbox]; Offline Fee Submission SMS: [checkbox]; Student Admission To Parent SMS: [checkbox]; Invoice Generated To Parent SMS: [checkbox]; Online Fee Submission To Parent SMS: [checkbox]; Offline Fee Submission To Parent SMS: [checkbox]; Student Absent Notification to Parent SMS: [checkbox]; Inquiry Received to Inquisitor SMS: [checkbox]; Inquiry Received to Admin SMS: [checkbox]
  - submit: Save
- **Fields (wlsm-save-school-whatsapp-settings-form):** Use WhatsApp: [checkbox]; Use WhatsApp for sending notifications [checkbox]; WhatsApp (Affiliated with Weblizar) API Details; API Key: [text]
  - submit: Save
- **Fields (wlsm-save-school-payment-method-settings-form):** Stripe Payment: [checkbox]; Enable [checkbox]; Stripe Publishable Key: [text]; Stripe Secret Key: [text]; PayU Payment: [checkbox]; PayU Merchant Key: [text]; PayU Merchant Salt: [text]; PayU Mode: [select]; PayPal Payment : [checkbox]; PayPal Business Email: [email]; Payment Mode: [select]; PayPal Notify URL; Razorpay Payment: [checkbox]; Razorpay Key: [text]; Razorpay Secret: [text]; Paytm Payment: [checkbox]; Paytm Merchant ID: [text]; Paytm Merchant Key: [text]; Paytm Industry Type ID: [text]; Paytm Website: [text]; Pesapal Payment: [checkbox]; Pesapal Consumer Key: [text]; Pesapal Consumer Secret: [text]; Pesapal Notify URL; Paystack Payment: [checkbox]; Public Key: [text]; Secret Key: [text]; SSLCommerz Payment: [checkbox]; SSLCommerz Store ID: [text]; SSLCommerz Store Passwd: [text]; SSLCommerz Notify URL; Bank Transfer Payment: [checkbox]; Branch Code: [text]; Account No.: [text]; Name: [text]; Instructions: [textarea]; Upi Transfer Payment: [checkbox]; Qr Code: [file]; UPI ID.: [text]; Amberpay Payment: [checkbox]; Amberpay Client Id: [text]; Amberpay Signature url: [text]; Amberpay Payment url: [text]; Amberpay api key: [text]; Cash Payment: [checkbox]; Check Payment: [checkbox]; Demand Draft Payment: [checkbox]; Card Payment: [checkbox]
  - submit: Save
- **Fields (wlsm-save-school-inquiry-settings-form):** Inquiry Form Title: [text]; Mandatory Phone Field; Yes [radio]; No [radio]; Mandatory Email Field; Admin Phone Number: [text]; Admin Email Address: [email]; Redirect URL: [text]; Success Message: [textarea]
  - submit: Save
- **Fields (wlsm-save-school-registration-settings-form):** Registration Form Title: [text]; Login after Registration: [checkbox]; Login after Registration [checkbox]; Redirect URL: [text]; Create Invoice from Fee Type: [checkbox]; Create Invoice from Fee Type? [checkbox]; Auto Generate Admission Number: [checkbox]; Auto Generate Admission Number for Back-end Form? [checkbox]; Auto Generate Roll Number: [checkbox]; Auto Generate roll Number for Back-end Form? [checkbox]; Admin Phone Number: [text]; Admin Email Address: [email]; Success Message: [textarea]; Declaration Message: [textarea]; Student Approval; If Checked Student Will Be Inactive After Registration From Front End. ( It Will Require Admin or Staff approval ) [checkbox]; Custom Registration Flow: [checkbox]; Custom Registration Flow (No Auto Numbers & Pending Status) [checkbox]; Student Last Name Required: [checkbox]; Make Student Last Name Mandatory [checkbox]; Date Of Birth: [checkbox]; Show Date Of Birth [checkbox]; Religion: [checkbox]; Show Religion [checkbox]; Gender: [checkbox]; Show Gender Field [checkbox]; Current Gender Options; Add New Option; Key (lowercase, no spaces): [text]; Display Label: [text]; Preview; Male; Female; Student Category: [checkbox]; Show Student Category Field [checkbox]; Current Category Options; Caste/Sub caste: [checkbox]; Show caste/sub caste [checkbox]; Blood Group: [checkbox]; Show blood_group [checkbox]; Phone: [checkbox]; Show phone [checkbox]; City: [checkbox]; Show city [checkbox]; State: [checkbox]; Show state [checkbox]; Country: [checkbox]; Show Country [checkbox]; Id Number / ID Proof: [checkbox]; Show Id Number [checkbox]; Transport Detail: [checkbox]; Show Transport Detail [checkbox]; Hostel Detail: [checkbox]; Show Hostel Detail [checkbox]; Survey Detail: [checkbox]; Show Survey Detail [checkbox]; Student login Panel: [checkbox]; Show Student Login Panel [checkbox]; Parents Detail Panel: [checkbox]; Show Parent Detail Panel [checkbox]; Parents login Panel: [checkbox]; Show Parents Login Panel [checkbox]; Guardian login Panel: [checkbox]; Show Guardian Login Panel [checkbox]; Occupation: [checkbox]; Show Occupation [checkbox]; Fees Detail: [checkbox]; Show Fees Detail [checkbox]; Medium Detail: [checkbox]; Show Medium [checkbox]
  - submit: Save
- **Fields (wlsm-save-school-examination-settings-form):** Admit Card Photo: [checkbox]; Show student photo on Admit Card [checkbox]; Exam Result Photo: [checkbox]; Show student photo on Exam Result [checkbox]
  - submit: Save Settings
- **Fields (wlsm-save-school-dashboard-settings-form):** Invoice: [checkbox]; Show Invoice [checkbox]; Payment History: [checkbox]; Show Payment History [checkbox]; Study Material: [checkbox]; Show study material [checkbox]; Homework: [checkbox]; Homework [checkbox]; Noticeboard: [checkbox]; Show noticeboard [checkbox]; Events: [checkbox]; Show Events [checkbox]; Calendar: [checkbox]; Show Calendar [checkbox]; class time table: [checkbox]; Show class time table [checkbox]; Live Classes: [checkbox]; Show Live classes [checkbox]; books issues: [checkbox]; Show books issues [checkbox]; Exam Time Table: [checkbox]; Show Exam Time Table [checkbox]; admit card: [checkbox]; Show admit card [checkbox]; Exam Result: [checkbox]; Show Exam Result [checkbox]; certificate: [checkbox]; Show certificate [checkbox]; Attendance: [checkbox]; Show attendance [checkbox]; leave request: [checkbox]; Show leave request [checkbox]; Lessons: [checkbox]; Show Lessons [checkbox]; Enrollment Number: [checkbox]; Show Enrollment Number [checkbox]; Admission Number: [checkbox]; Show Admission Number [checkbox]; Fee Structure: [checkbox]; Show Fee Structure [checkbox]; Support Tickets: [checkbox]; Show Support Tickets [checkbox]; SM Chat: [checkbox]; Show SM Chat [checkbox]; Stationary: [checkbox]; Show Stationary [checkbox]; ID Card: [checkbox]; Show ID Card [checkbox]; Fee Invoice: [checkbox]; Show Fee Invoice [checkbox]; Show Noticeboard [checkbox]; Class Time Table: [checkbox]; Show Class Time Table [checkbox]; Exam Results: [checkbox]; Show Exam Results [checkbox]; Show Attendance [checkbox]
  - submit: Save
- **Fields (wlsm-save-school-charts-settings-form):** Monthly Admissions: [select]; Enable [checkbox]; Monthly Payments: [select]; Monthly Donation / Expense: [select]; Payments vs Expenses: [select]
  - submit: Save
- **Fields (wlsm-save-school-zoom-settings-form):** Bigbluebutton URl : [text]; Bigbluebutton Secret: [text]
  - submit: Save
- **Fields (wlsm-save-school-logs-settings-form):** Enable Logging; Yes [radio]; No [radio]; Number of days to keep the logs: [number]
  - submit: Save
- **Fields (wlsm-save-school-url-settings-form):** Certificate URL : [checkbox]; Result URL : [text]; Admit card URL : [text]
  - submit: Save
- **Fields (wlsm-save-school-lessons-settings-form):** Enable Student Login; Yes [radio]; No [radio]
  - submit: Save
- **Fields (wlsm-save-school-card-backgrounds-settings-form):** Upload Id Card Background: [file]; Choose File [file]; Upload Invoice Background: [file]
  - submit: Save

## Logs

`page=sm-staff-logs`

- **Columns:** Logged Message, Group, Date & Time

## Setup Wizard

`page=wlsm-staff-setup-wizard`


## SM Academic — Academic

`page=sm-staff-academic`


## Manage Medium

`page=sm-staff-medium`

- **Columns:** #, Medium, Action
- **Fields (wlsm-save-medium-form):** Medium: [text]
  - submit: Add New Medium

## Manage House

`page=sm-staff-house`

- **Columns:** #, House, Action
- **Fields (wlsm-save-house-form):** House Name: [text]
  - submit: Add New House

## Manage Student type

`page=sm-staff-student-type`

- **Columns:** #, Student Type, Action
- **Fields (wlsm-save-student-type-form):** Student Type: [text]
  - submit: Add New Student Type

## Subjects

`page=sm-staff-subjects`

- **Buttons:** Add New Subject Types, Add New Subject, Assign Subject in Bulk
- **Columns:** Subject Name, Subject Code, Subject Type, Class, Teachers, Action

## Class Timetable — Class Timetables

`page=sm-staff-timetable`

- **Buttons:** Add New Routine
- **Columns:** Class, Section, Action

## Staff Time Table — Staff Timetable

`page=sm-staff-member-timetable`

- **Columns:** Class, Section, Subjects, Room, Time, Day, Action

## Attendance — View Attendance

`page=sm-staff-attendance`

- **Buttons:** Attendance report, Take Attendance, Webcam Attendance, QR Attendance
- **Fields (wlsm-view-attendance-form):** Attendance By Month [radio]; Attendance By Subject [radio]; Class: [select]; Section: [select]; Month: [text]; Subject: [select]

## Student Leaves

`page=sm-staff-student-leaves`

- **Buttons:** Add New Leave
- **Columns:** Enrollment Number, Student Name, Class, Section, Reason, Leave Date, Status, Action

## Study Materials

`page=sm-staff-study-materials`

- **Buttons:** Add New Study Material
- **Columns:** Title, Class, Subject, Description, Date Added, Added By, Action

## Homework

`page=sm-staff-study-homework`

- **Buttons:** Add New Homework
- **Columns:** Title, Description, Class, Date, Due Date, Added By, Action
- **Fields (wlsm-filter-homeworks-form):** Class: [select]; From Date: [text]; To Date: [text]

## Noticeboard

`page=sm-staff-notices`

- **Buttons:** Add New Notice
- **Columns:** Notice, Link To, Is Active, Date, Added By, Action

## Events

`page=sm-staff-events`

- **Buttons:** Add New Event
- **Columns:** Event Title, Event Date, Total Participants, Is Active, Action

## Calendar

`page=sm-staff-calendar`

- **Buttons:** Add Event, Add Holiday

## Holidays

`page=sm-staff-holidays`

- **Buttons:** Add New Holiday
- **Columns:** Description, Start Date, End Date, Action

## Live Classes

`page=sm-staff-live-classes`

- **Buttons:** Add New Live Class
- **Columns:** Topic, Host ID, Duration (minutes), Meeting ID, Start Class, Start Date / Time, Type, Join URL, Class, Subject, Teacher, Action

## Staff Rating

`page=sm-staff-ratting`

- **Columns:** Class, Subject, Teacher, Student Feedback, Average Rating, Action

## Student Birthdays — Students Birthdays

`page=sm-student-birthdays`

- **Columns:** Admission Number, Name, Class, Section, Phone, DOB, Email
- **Fields (wlsm-fetch-student-birthdays-form):** Start Date; End Date: [text]

## SM Student — Student

`page=sm-staff-student`


## Inquiries

`page=sm-staff-inquiries`

- **Buttons:** Add New Inquiry
- **Columns:** Class, Name, Phone, Email, Message, Date, Follow Up Date, Status, Action
  - submit: Export

## Pre-Admissions

`page=sm-staff-pre-admissions`

- **Buttons:** Add Student
- **Columns:** Class, Section, Student Name, Admission Number, Phone, Father Name, Father Phone, Admission Date, Status, Action
  - submit: Export

## Students

`page=sm-staff-students`

- **Buttons:** Add Student
- **Columns:** Student Name, Admission Number, Type, Phone, Email, Class, Section, Roll Number, Status, Father's Name, Father's Phone, Login Email, Login Username, Admission Date, Enrollment Number, Registration From Front, Session Records, ID Card, Student ID Proof, Print Student Detail, Attendance Report, Fee Structure, Action
- **Fields (wlsm-get-students-form):** Search By Keyword [radio]; Search By Class [radio]; Search Field: [select]; Keyword: [text]; Class: [select]; Section: [select]
  - submit: Export

## Print ID Cards

`page=sm-staff-id-cards`

- **Buttons:** Print Selected Cards
- **Columns:** Student Name, Admission Number, Class, Section, Roll Number, Father's Name, Phone, Action
- **Fields (wlsm-get-students-print-form):** Class: [select]; Section: [select]; ID Card Template: [select]

## ID Card Layouts

`page=sm-staff-custom-id-cards`

- **Buttons:** Add New Layout
- **Columns:** Title, Action

## Promote — Student Promotion

`page=sm-staff-promote`

- **Fields (wlsm-promote-student-form):** Promote to Session: [select]; Promotion From Class: [select]; Promotion To Class: [select]

## Transfer Student — Students Transferred

`page=sm-staff-transfer-student`

- **Buttons:** Transfer Student
- **Columns:** Student Name, Admission Number, Phone, Email, Class, Section, Roll Number, Father's Name, Father's Phone, Admission Date, Enrollment Number, Status, Transferred to, Transfer Date, Note, Action
- **Columns:** Student Name, Admission Number, Phone, Email, Class, Section, Roll Number, Father's Name, Father's Phone, Admission Date, Enrollment Number, Status, Transferred To, Transfer Date, Note, Action

## Transfer certificate — Transfer Certificates

`page=sm-staff-transfer-certificates`

- **Buttons:** Issue New Transfer Certificate
- **Columns:** Certificate Number, Student, Admission Number, Class, Section, Certificate, Issued Date, Student Status, Action

## Certificates

`page=sm-staff-certificates`

- **Buttons:** Add New Certificate
- **Columns:** Title, Total Certificates Distributed, Distribute Certificate, Action

## Notifications

`page=sm-staff-notifications`


## SM Administrator

`page=sm-staff-administrator`


## Admins

`page=sm-staff-admins`


## Roles

`page=sm-staff-roles`


## Staff List

`page=sm-staff-employees`


## Staff Attendance

`page=sm-staff-employees-attendance`


## Staff Leaves

`page=sm-staff-employee-leaves`


## Staff ID Cards

`page=sm-staff-staff-id-cards`


## Staff Payroll — Staff Payroll & Salary Slips

`page=sm-staff-payrolls`

- **Buttons:** Generate Salary Slip
- **Columns:** Staff Name, Designation, Month, Base Salary, Net Salary, Payment Method, Date, Action

## SM Accounting — Accounting

`page=sm-staff-accounting`

- **Columns:** Receipt Number, Amount, Payment Method, Transaction ID, Date, Invoice, Student Name, Admission Number, Class, Section, Phone, father Name, father Phone, Delete

## Fee Types

`page=sm-staff-fees`

- **Buttons:** Add New Fee Type
- **Columns:** Fee Label, Class, Amount, Period, Action

## Concession Types

`page=sm-staff-concession`

- **Buttons:** Add New Concession Type
- **Columns:** Concession Name, Concession Type, Value, Class, Session, Status, Action

## Students Concession — Students with Concession

`page=sm-staff-students-concession`

- **Columns:** Student Name, Admission Number, Class, Section, Concession Name, Status, Approved By, Applied Date, Action
- **Fields (wlsm-get-students-concession-form):** Class: [select]; Concession Type: [select]

## Fee Invoices — Student Fee Invoices

`page=sm-staff-invoices`

- **Buttons:** Verify Payments, Payment History, Add New Fee Invoice
- **Columns:** Student Name, Father's Name, Admission Number, Invoice Number, Invoice Title, Payable, Paid, Due, Status, Date Issued, Due Date, Phone, Class, Section, Enrollment Number, Action
- **Fields (wlsm-get-invoices-form):** Search By Keyword [radio]; Search By Class [radio]; Search By Date [radio]; Search Field: [select]; Keyword: [text]; Class: [select]; Section: [select]; Status: [select]; Start Date: [select]; End Date: [text]
  - submit: Export

## Transport Invoices

`page=sm-staff-transport-invoices`

- **Columns:** Student Name, Enrollment No., Class / Section, Route / Vehicle, Fare/Month, Paid, Unpaid, Not Generated, Action
- **Fields (wlsm-get-transport-students-form):** Class: [select]; Section: [select]; Status: [select]
- **Fields (wlsm-assign-route-form):** Student; Select Route [select]; Select Vehicle (Fare) [select]
  - submit: Assign Route

## Collect Payment — Collect Payments

`page=sm-staff-collect-payment`

- **Buttons:** Add New Fee Invoice
- **Columns:** Student Name, Father's Name, Admission Number, Invoice Number, Invoice Title, Payable, Paid, Due, Status, Date Issued, Due Date, Phone, Class, Section, Enrollment Number, Action
- **Fields (wlsm-get-invoices-form):** Class: [select]; Section: [select]; Student: [select]; Status: [select]; Start Date; End Date: [text]
- **Fields (wlsm-bulk-collect-fee-form):** Payment Amount: [number]; Payment Method: [select]; Payment Date: [text]; Bank Name: [text]; Cheque Number: [text]; Cheque Date: [text]; Transaction ID / Reference: [text]; Authorized By: [text]; Note: [textarea]
  - submit: Collect Payment

## Donation

`page=sm-staff-income`

- **Buttons:** Donation Categories, Add New Donation
- **Columns:** Title, Category, Doner Name, Amount, Invoice Number, Date, Note, Action
- **Fields (wlsm-fetch-income-form):** Start Date: [text]; End Date: [text]
  - submit: Export

## Expenses

`page=sm-staff-expenses`

- **Buttons:** Expense Categories, Add New Expense
- **Columns:** Title, Category, Supplier Name, Amount, Invoice Number, Date, Note, Action
- **Fields (wlsm-fetch-expenses-form):** Start Date: [text]; End Date: [text]; Total: 0.00
  - submit: Export

## Bulk Invoices Print — Print Invoices in Bulk

`page=sm-staff-invoices-print`

- **Fields (wlsm-print-bulk-invoices-form):** Class: [select]; Section: [select]; Status: [select]
  - submit: Print Invoices

## SM Examination — Examination

`page=sm-staff-examination`


## Manage Exams

`page=sm-staff-exams`

- **Buttons:** Add New Exam
- **Columns:** Exam Title, Class, Exam Center, Start Date, End Date, Time Table, Admit Cards, Exam Results, Status, Action

## Manage Groups — Manage Exams group

`page=sm-exams-group`

- **Buttons:** Add New Exam Group
- **Columns:** Exam Group, Status, Action

## Admit Cards — Manage Exam Admit Cards

`page=sm-staff-exam-admit-cards-print`

- **Buttons:** Print Admit Cards In Bulk
- **Columns:** Exam Title, Class, Exam Center, Start Date, End Date, Generate Admit Cards, View Admit Cards

## Admit Cards Bulk Print — Print Admit Cards in Bulk

`page=admit-cards-bulk-print`

- **Fields (wlsm-print-bulk-admit-cards-form):** Class: [select]; Section: [select]; Exams
  - submit: Print Admit Cards

## Exam Results — Manage Exam Results

`page=sm-staff-exam-results`

- **Columns:** Exam Title, Class, Exam Center, Start Date, End Date, Add Results, View Results

## Bulk Print Results — Print Results in Bulk

`page=sm-staff-exam-results-bulk-print`

- **Fields (wlsm-print-bulk-result-form):** Class: [select]; Section: [select]; Exams: [select]
  - submit: Print Results

## Academic Report — Academic Reports

`page=sm-staff-academic-report`

- **Buttons:** Add New Academic Report
- **Columns:** Report Title, Class, Exams, Group, Action

## Academic Multi Group Reports

`page=sm-staff-academic-multi-group-report`

- **Buttons:** Add New Academic Multi Group Report
- **Columns:** Report Title, Class, Session, Groups, Action

## SM Library — Library

`page=sm-staff-library`


## All Books — Books

`page=sm-staff-books`

- **Buttons:** View Books Issued, Add New Books In Bulk, Add New Book
- **Columns:** Title, Author, Subject, Rack Number, Book Number, ISBN Number, Price, Quantity, Issue Book, Action

## Books Issued

`page=sm-staff-books-issued`

- **Buttons:** Issue Book
- **Columns:** Book Title, Issued to, Enrollment Number, Class, Section, Issued Quantity, Date Issued, Return Date, Status, Author, Subject, Rack Number, Book Number, ISBN Number, Price, Action

## Library Cards

`page=sm-staff-library-cards`

- **Buttons:** Issue Library Cards
- **Columns:** Card Number, Issued to, Enrollment Number, Class, Section, Date Issued, Print, Action

## SM Transport — Transport

`page=sm-staff-transport`


## Vehicles

`page=sm-staff-vehicles`

- **Buttons:** Add New Vehicle
- **Columns:** Vehicle Number, Vehicle Model, Driver Name, Driver Phone, In-charge, Action

## Routes — Transport Routes

`page=sm-staff-routes`

- **Buttons:** Add New Route
- **Columns:** Route Name, Route Fare, Number of Vehicles, Action

## Report — Students Transport Report

`page=sm-staff-transport-report`

- **Buttons:** Transport Routes, Transport Vehicles
- **Fields (wlsm-get-transport-report-form):** Class: [select]; Section: [select]; Transport Route: [select]; Transport Vehicle: [select]

## SM Activities — Acitvities

`page=wp_wlsm_activities`

- **Buttons:** Add New Activity
- **Columns:** Name, Class, Fee, Description, Status, Action

## SM Hostel — Hostels

`page=sm-staff-hostel`


## Hostels

`page=sm-staff-hostel-dash`

- **Buttons:** Add New Hostel
- **Columns:** ID, Hostel Name, Hostel Type, Rooms, Address, Intake, Action

## Rooms

`page=sm-staff-rooms`

- **Buttons:** Add New Room
- **Columns:** ID, Room Number, Number of bed, Action

## SM Lessons — Lessons

`page=wp_wlsm_lecture`

- **Buttons:** Chapter's, Add New Lesson
- **Columns:** Title, Class, Subject, Chapter, Created On, Action

## Chapter — Chapters

`page=wp_wlsm_chapter`

- **Buttons:** Add New Chapter
- **Columns:** Title, Subject, Created On, Action

## SM Tickets — Tickets

`page=wlsm_tickets_dashboard`


## Tickets — Tickets Management

`page=wp_wlsm_tickets`

- **Buttons:** Create New Ticket
- **Columns:** #, Title, Priority, Status, Subject, Student Name, Class, Role, Assigned To, Due Date, Created On, Action

## SM Stationary — Stationary

`page=sm-staff-stationary`


## Categories — Stationary Categories

`page=sm-staff-stationary-categories`

- **Buttons:** Add New Category
- **Columns:** Category Name, Items Count, Action

## Items — Stationary Items

`page=sm-staff-stationary-items`

- **Buttons:** Add New Item
- **Columns:** Image, Item Name, Category, Unit, Price, Stock, Action

## Issued Items — Issued Stationary

`page=sm-staff-stationary-issued`

- **Buttons:** Issue Item
- **Columns:** Item, Issued To, Price, Quantity, Issue Date, Note, Invoice / Status, Action

## SM Gate Pass — Gate Passes

`page=sm-staff-gate-passes`

- **Buttons:** Add Gate Pass
- **Columns:** Visitor Name, Mobile, Relation, Student, Class, Section, Date, In Time, Out Time, Authorized By, Action

## SM Reports — Reports Dashboard

`page=sm-staff-reports`


## Fee Collection Report

`page=sm-staff-reports-fee`

- **Columns:** Student Name, Admission No., Invoice Number, Fee Type, Payable, Paid, Due, Status, Action
- **Fields (wlsm-get-invoices-report-form):** Class: [select]; Section: [select]; Status: [select]; Fee Type: [select]; Payment Method: [select]; From Date: [text]; To Date: [text]

## Fee Defaulters — Fee Defaulters & Outstanding Due Report

`page=sm-staff-reports-defaulters`

- **Columns:** #, Student Name, Roll No., Admission No., Class & Section, Parent Contact, Invoice No., Due Date, Payable, Paid, Due Balance, Overdue Days, Status
- **Fields (wlsm-defaulters-report-form):** Class: [select]; Section: [select]; Overdue Aging: [select]; Due Date From: [text]; Due Date To: [text]
  - submit: Filter Report

## Academic Reports — Academic & Exam Reports

`page=sm-staff-reports-academic`

- **Columns:** #, Student Name, Roll No., Admission No., Class & Section, Exam Title, Obtained / Total, Percentage, Grade, Status
- **Fields (wlsm-academic-report-form):** Class: [select]; Section: [select]; Exam: [select]; Result Status: [select]
  - submit: Filter Report

## Enrollment Reports — Enrollment & Student Reports

`page=sm-staff-reports-enrollment`

- **Columns:** #, Student Name, Roll No., Admission No., Admission Date, Class & Section, Gender, Phone Number, Status
- **Fields (wlsm-enrollment-report-form):** Class: [select]; Section: [select]; Gender: [select]; Status: [select]; Admission Date From: [text]; Admission Date To: [text]
  - submit: Filter Report

## Attendance Report

`page=sm-staff-reports-attendance`

- **Columns:** #, Student Name, Roll No., Admission No., Class & Section, Total Working Days, Present, Absent, Late, Attendance %, Status, Contact
- **Fields (wlsm-attendance-report-form):** Class: [select]; Section: [select]; Attendance Filter: [select]; Date Range From: [text]; Date Range To: [text]
  - submit: Filter Report

## SM Chat — Chat

`page=sm-staff-chat`

  - submit: Send
- **Fields (wlsm-create-chat-form):** Chat Type; Direct (one or more students) [radio]; Named Group [radio]; Group Name: [text]; Class: [select]; Section: [select]; Students: [select]
  - submit: Start Chat

### Add Class

`page=sm-staff-school-classes&action=save`

- **Fields (wlsm-save-school-class-form):** Class Name: [text]
  - submit: Add New Class

### Manage Sections — Classes and Sections

`page=sm-staff-classes`

- **Columns:** Class Name, Class Group, Number of Sections, Total Students, Head of Group

### Assign Admins

`page=sm-schools&action=admins&id=14`

- **Columns:** Name, Username, Email, Assigned By, Action
- **Fields (wlsm-assign-admin-form):** Assign New Admin; Existing User? [radio]; New User? [radio]; Name: [text]; Username: [text]; Email: [text]; Password: [password]
  - submit: Assign Admin

### Add New Subject Types

`page=sm-staff-subjects&action=save_subject_type`

- **Columns:** ID, Subject Type, Action
- **Fields (wlsm-save-subject-type-form):** Subject Type: [text]
  - submit: Add New Subject Type

### Add New Subject

`page=sm-staff-subjects&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-subject-form):** Subject Name: [text]; Subject Code: [text]; Subject Type: [select]; Class: [select]; Upload Subject Image (Optional) [file]; Choose Image [file]
  - submit: Add New Subject

### Add New Routine — Add New Class Routine

`page=sm-staff-timetable&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-routine-form):** Class: [select]; Section: [select]; Subject: [select]; Start Time: [text]; End Time: [text]; Day: [select]; Room Number: [text]; Teacher: [select]
  - submit: Add New Routine

### Attendance report — Attendance Report

`page=sm-staff-attendance&action=report`

- **Buttons:** Back

### Take Attendance

`page=sm-staff-attendance&action=save`

- **Buttons:** View Attendance
- **Fields (wlsm-take-attendance-form):** Attendance By Month [radio]; Attendance By Subject [radio]; Class: [select]; Section: [select]; Date: [text]; Subject: [select]

### Webcam Attendance — Webcam Student Attendance

`page=sm-staff-attendance&action=webcam_attendance`

- **Buttons:** Back to Dashboard

### QR Attendance — QR Student Attendance

`page=sm-staff-attendance&action=qr_attendance`

- **Buttons:** Back to Dashboard

### Add New Leave — Add Student Leave

`page=sm-staff-student-leaves&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-student-leave-form):** Class: [select]; Section: [select]; Student: [select]; Number of Leave Days; Single Day [radio]; Multiple Days [radio]; Start Date: [text]; End Date: [text]; Reason: [textarea]; Status; Approved [radio]; Pending [radio]; Rejected [radio]
  - submit: Add Student Leave

### Add New Study Material

`page=sm-staff-study-materials&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-study-material-form):** Class: [select]; Section: [select]; Subject: [select]; Title: [text]; Description: [textarea]; URL: [text]; Make study material downloadable in application. [checkbox]; Study Materials: [file]
  - submit: Add New Study Material

### Add New Homework — Assign Homework

`page=sm-staff-study-homework&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-homework-form):** Title; Class: [select]; Section: [select]; Date: [text]; Due Date: [text]; Subject: [select]; Description: [textarea]; Homework: [file]; Attachment URL: [url]; Make Homework downloadable in application [checkbox]; Send SMS to Students [checkbox]; Send SMS to Parents [checkbox]
  - submit: Assign Homework

### Add New Notice

`page=sm-staff-notices&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-notice-form):** Notice Title: [text]; Class: [select]; Notice Description: [textarea]; Link to; None [radio]; Attachment [radio]; URL [radio]; Notice URL: [text]; Attachment: [file]; Choose Attachment File [file]; Status; Approved / Active [radio]; Inactive [radio]
  - submit: Add New Notice

### Add New Event

`page=sm-staff-events&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-event-form):** Event Title: [text]; Event Date: [text]; Event Description: [textarea]; Upload Event Image [file]; Choose Image [file]; Status; Approved / Active [radio]; Inactive [radio]
  - submit: Add New Event

### Add Holiday — Add New Holiday

`page=sm-staff-holidays&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-holiday-form):** Description: [textarea]; Start Date: [text]; End Date: [text]
  - submit: Add New Holiday

### Add New Live Class

`page=sm-staff-live-classes&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-meeting-form):** Zoom Live Class [radio]; Big Blue Button [radio]; Class: [select]; Section: [select]; Subject: [select]; Teacher: [select]; Class Type: [select]; Start Date / Time: [text]; Duration (minutes): [number]; Moderator code: [text]; Viewer Password: [text]; Topic: [text]; Agenda: [textarea]; Approval Type: [select]; Registration Type: [select]; Recurrence Type: [select]; Repeat Interval: [number]; Weekly Days: [select]; Monthly Day: [number]; End Times: [number]; End Date / Time: [text]; Allow participants to join the class before the host starts the class. Only used for scheduled or recurring classes. [checkbox]; Start video when the host joins the class. [checkbox]; Start video when participants join the class. [checkbox]; Mute participants upon entry. [checkbox]; Wait for moderator [checkbox]; Allow Recording [checkbox]; Disable Shared Notes [checkbox]; Disable Private Chat [checkbox]; Disable Public Chat [checkbox]; Disable Webcams [checkbox]; Disable Microphones [checkbox]
  - submit: Add New Live Class

### Add New Inquiry

`page=sm-staff-inquiries&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-inquiry-form):** Name: [text]; Class: [select]; Section: [select]; Phone: [text]; Email: [email]; Reference: [text]; Message: [textarea]; Next Follow Up Date: [text]; Note: [textarea]; Active [radio]; Inactive [radio]
  - submit: Add New Inquiry

### Add Student — New Admission For Session: 2026-2027

`page=sm-staff-admissions`

- **Buttons:** Bulk Admission, View Students
- **Fields (wlsm-add-admission-form):** First Name: [text]; Middle Name: [text]; Last Name: [text]; Gender; Male [radio]; Female [radio]; Date of Birth: [text]; Religion: [text]; Caste/Sub Caste: [text]; Address: [textarea]; Phone: [number]; Email: [email]; City: [text]; State: [text]; Extra Note / Detail: [textarea]; Category: [select]; Dob in word: [text]; Mother Tongue: [text]; Birth Place: [text]; School Name: [text]; School Address: [text]; Class: [text]; Passout Year: [text]; Admission Date: [text]; Student Type; Class: [select]; Section: [select]; Admission Number: (Auto Generated) [text]; Roll Number: [text]; Upload Photo: [file]; Choose File [file]; Medium: [select]; House: [select]; Subject; Transport Route and Vehicle: [select]; Fee Type: [text]; Period: [select]; Amount: [number]; Assign Concession: [select]; Disallow Login? [radio]; Existing User? [radio]; New User? [radio]; Existing Username: [text]; Username: [text]; Login Email: [email]; Password: [password]; Student Status: [select]; Suspend Student [checkbox]; Start Date: [text]; End Date: [text]; Suspension Message: [textarea]
  - submit: Submit

### Add New Layout — Add New ID Card Layout

`page=sm-staff-custom-id-cards&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-id-card-form):** Visible [checkbox]; [checkbox]; Layout Name [text]; Orientation [select]; Background Image [file]; Choose File [file]
  - submit: Save

### Transfer Student

`page=sm-staff-transfer-student&action=save`

- **Buttons:** View Students Transferred
- **Fields (wlsm-transfer-student-form):** Class: [select]; Section: [select]; Student: [select]; School: [select]; Note: [textarea]

### Issue New Transfer Certificate — Transfer Certificate / Step 1: Select Student / Step 2: Student Information / Step 3: Issue Transfer Certificates

`page=sm-staff-transfer-certificates&action=save`

- **Buttons:** View Transferred certificates
- **Fields (wlsm-transfer-certificate-form):** Class: [select]; Section: [select]; Student: [select]; Certificates to Issue: [select]; Student Status After Transfer; Keep Active [radio]; Make Inactive [radio]; Remarks (Optional): [textarea]

### Add New Certificate

`page=sm-staff-certificates&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-certificate-form):** Certificate Title: [text]; Orientation: [select]; Certificate Number Prefix: [text]; Starting Base Number: [text]; Exams: [select]
  - submit: Add New Certificate

### Generate Salary Slip

`page=sm-staff-payrolls&action=save`

- **Buttons:** Back to Payrolls
- **Fields (ref: <Node>):** Select Staff Member / Teacher: [select]; Salary Month & Year: [text]; Base Monthly Salary: [number]; Allowances / Bonus (+): [number]; Deductions / Leaves (-): [number]; Payment Date: [text]; Payment Method: [select]; Reference / Transaction No: [text]; Note / Remarks: [textarea]
  - submit: Generate & Save Salary Slip

### Add New Fee Type

`page=sm-staff-fees&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-fee-form):** Fee Label: [text]; Session: [select]; Class: [select]; Student type: [select]; Period: [select]; Amount: [number]; Auto Generate Invoice On Admission [checkbox]; Include On Promotion [checkbox]; If disabled, this fee will not be assigned or invoiced when a student is promoted. [checkbox]; Dashboard Disable? [checkbox]; If Enabled: User Can Not Access Dashboard Until Fee is Paid Fully.
  - submit: Add New Fee Type

### Add New Concession Type

`page=sm-staff-concession&action=save`

- **Buttons:** View All
- **Columns:** Fee Type Name, Amount, Period, Period Value, Session Total
- **Fields (wlsm-save-concession-form):** Concession Name: [text]; Class; Concession Type; Fixed Amount [radio]; Percentage [radio]; Fixed Amount: [number]; Percentage Value: [number]; Applicable Fee Types; Eligibility Criteria: [textarea]; Active [checkbox]
  - submit: Add New Concession Type

### Verify Payments

`page=sm-staff-invoices&action=pending_payments`

- **Buttons:** Payment History, Add New Fee Invoice, View Invoices
- **Columns:** Receipt Number, Amount, Payment Method, Transaction ID, Attachment, Date, Invoice, Approve, Student Name, Admission Number, Class, Section, Enrollment Number, Phone, father Name, father Phone, Delete

### Payment History

`page=sm-staff-invoices&action=payment_history`

- **Buttons:** Pending Payments, Add New Fee Invoice, View Invoices
- **Columns:** Receipt Number, Amount, Payment Method, Transaction ID, Attachment, Date, Note, Invoice, Student Name, Admission Number, Class, Section, Enrollment Number, Phone, father Name, father Phone, Print, Delete
- **Fields (wlsm-fetch-payments-form):** Start Date; End Date: [text]; Total: [text]
  - submit: Export

### Add New Fee Invoice

`page=sm-staff-invoices&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-invoice-form):** Create Single Invoice [radio]; Create Bulk Invoice [radio]; Create Single Invoice Accroding Fee Type [radio]; Class: [select]; Section: [select]; Student: [select]; Fee Label: [text]; Period: [select]; Amount: [number]; Invoice Title: [text]; Allow Partial Payments? [checkbox]; Description: [textarea]; Total Fee Type Amount: [div]; Total Amount: [number]; Payable Amount: [number]; Discount Percentage: [number]; Discount Amount: [number]; Date Issued: [text]; Due Date: [text]; Due Date Amount: [text]; Collect Payment? [checkbox]; Bank Name: [text]; Cheque Date: [text]; Payment Method: [select]; Payment Date: [text]; Transaction ID: [text]; Cheque Number: [text]; Authorized By: [text]; Additional Note: [textarea]
  - submit: Add New Fee Invoice

### Donation Categories

`page=sm-staff-income&action=category`

- **Buttons:** View Donation
- **Columns:** Category, Action
- **Fields (wlsm-save-income-category-form):** Category: [text]
  - submit: Add Donation Category

### Add New Donation

`page=sm-staff-income&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-income-form):** Title: [text]; Category: [select]; Doner Name: [text]; Amount: [number]; Invoice Number: [text]; Donation Date: [text]; Attachment: [file]; Note: [textarea]
  - submit: Add New Donation

### Expense Categories

`page=sm-staff-expenses&action=category`

- **Buttons:** View Expenses
- **Columns:** Category, Action
- **Fields (wlsm-save-expense-category-form):** Category: [text]
  - submit: Add Expense Category

### Add New Expense

`page=sm-staff-expenses&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-expense-form):** Title: [text]; Category: [select]; Supplier Name: [text]; Amount: [number]; Invoice Number: [text]; Expense Date: [text]; Attachment: [file]; Note: [textarea]
  - submit: Add New Expense

### Add New Exam

`page=sm-staff-exams&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-exam-form):** Exam Title: [text]; Exam Center: [text]; Start Date: [text]; End Date: [text]; Class; Exam Group: [select]; Exam Type: [select]; Subject Name: [text]; Subject Type: [select]; Maximum Marks: [number]; Paper Code / Subject Code: [text]; Paper Date: [text]; Start Time: [text]; End Time: [text]; Room Number: [text]; Enable [radio]; Disable [radio]; Published [radio]; Unpublished [radio]; Enabled [radio]; Disabled [radio]; Show Subject-wise Result Status; Subject Pass Threshold (%): [number]; Subject Status Column Header: [text]; Subject Pass Label: [text]; Subject Fail Label: [text]; Show Overall Result Status; Overall Pass Threshold (%): [number]; Max Failed Subjects Allowed: [number]; Overall Result Row Header: [text]; Overall Pass Label: [text]; Overall Fail Label: [text]; Show Subject Type; Yes [radio]; No [radio]; Show Subject Code; Class-wise Rank [radio]; Section-wise Rank [radio]; Show Signature in Exam; Upload Signature: [file]; Active [radio]; Inactive [radio]
  - submit: Add New Exam

### Add New Exam Group

`page=sm-exams-group&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-exam-group-form):** Exam Group Title: [text]; Active [radio]; Inactive [radio]
  - submit: Add New Exam Group

### Print Admit Cards In Bulk — Print Admit Cards in Bulk

`page=admit-cards-bulk-print`

- **Fields (wlsm-print-bulk-admit-cards-form):** Class: [select]; Section: [select]; Exams
  - submit: Print Admit Cards

### Add New Academic Report

`page=sm-staff-academic-report&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-report-form):** Report Title: [text]; Group: [select]; Class; Exams: [select]
  - submit: Add New Report

### Add New Academic Multi Group Report

`page=sm-staff-academic-multi-group-report&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-report-form):** Report Title: [text]; Session: [select]; Class; Exam Groups: [select]; Exam Type Filter: [select]
  - submit: Add New Multi Group Report

### View Books Issued — Books Issued

`page=sm-staff-books-issued`

- **Buttons:** Issue Book
- **Columns:** Book Title, Issued to, Enrollment Number, Class, Section, Issued Quantity, Date Issued, Return Date, Status, Author, Subject, Rack Number, Book Number, ISBN Number, Price, Action

### Add New Book

`page=sm-staff-books&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-book-form):** Title: [text]; Author: [text]; Subject: [text]; Price: [number]; Quantity: [number]; Description: [textarea]; Rack Number: [text]; Book Number: [text]; ISBN Number: [text]
  - submit: Add New Book

### Issue Book — Books

`page=sm-staff-books`

- **Buttons:** View Books Issued, Add New Books In Bulk, Add New Book
- **Columns:** Title, Author, Subject, Rack Number, Book Number, ISBN Number, Price, Quantity, Issue Book, Action

### Issue Library Cards

`page=sm-staff-library-cards&action=issue`

- **Buttons:** View Library Cards
- **Fields (wlsm-issue-library-cards-form):** Starting Library Card Number & Prefix: For example, enter "LC" and "10001" to create library card numbers - LC10001, LC10002, LC10003 and so on.; Class: [select]; Section: [select]; Date Issued: [text]

### Add New Vehicle

`page=sm-staff-vehicles&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-vehicle-form):** Vehicle Number: [text]; Vehicle Model: [text]; Driver Name: [text]; Driver Phone: [text]; Note: [textarea]
  - submit: Add New Vehicle

### Add New Route — Add New Transport Route

`page=sm-staff-routes&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-route-form):** Route Name: [text]; Route Fare: [number]; Period: [select]; Transport Vehicles: [select]
  - submit: Add New Route

### Transport Routes

`page=sm-staff-routes`

- **Buttons:** Add New Route
- **Columns:** Route Name, Route Fare, Number of Vehicles, Action

### Transport Vehicles — Vehicles

`page=sm-staff-vehicles`

- **Buttons:** Add New Vehicle
- **Columns:** Vehicle Number, Vehicle Model, Driver Name, Driver Phone, In-charge, Action

### Add New Activity — Add Student Activity

`page=wp_wlsm_activities&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-student-activity-form):** Title; Fees; Class; Description: [textarea]; Status; Active [radio]; Inactive [radio]
  - submit: Add Student Activity

### Add New Hostel

`page=sm-staff-hostel-dash&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-hostel-form):** Hostel Name: [text]; Hostel Type; Hostel Address: [text]; Hostel Capacity: [number]; Hostel fees: [number]
  - submit: Add New Hostel

### Add New Room

`page=sm-staff-rooms&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-room-form):** Room Number: [text]; Number of bed: [number]; Hostel: [select]; Note
  - submit: Add New Room

### Chapter's — Chapters

`page=wp_wlsm_chapter`

- **Buttons:** Add New Chapter
- **Columns:** Title, Subject, Created On, Action

### Add New Lesson

`page=wp_wlsm_lecture&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-lecture-form):** Title; Class: [select]; Subject: [select]; Chapter: [select]; Link to; None [radio]; Attachment [radio]; URL [radio]; Media URL: [text]; Attachment: [file]; Choose Attachment File [file]; Description: [select]
  - submit: Add New Lesson

### Add New Chapter

`page=wp_wlsm_chapter&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-chapter-form):** Title; Class: [select]; Subject: [select]
  - submit: Add New Chapter

### Create New Ticket

`page=wp_wlsm_tickets&action=save`

- **Fields (wlsm-save-ticket-form):** Ticket Title * [text]; Due Date * [text]; Class * [select]; Section * [select]; Student * [select]; Subject [select]; Role [select]; Assign To [select]; Description [textarea]; Priority [select]; Status [select]
  - submit: Create Ticket

### Add New Category

`page=sm-staff-stationary-categories&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-stationary-category-form):** Category Name: [text]
  - submit: Add New Category

### Add New Item

`page=sm-staff-stationary-items&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-stationary-item-form):** Item Name: [text]; Category: [select]; Unit: [text]; Price: [number]; Quantity: [number]; Description: [textarea]; Item Image: [file]
  - submit: Add New Item

### Issue Item — Issue Stationary Item

`page=sm-staff-stationary-issued&action=save`

- **Buttons:** View All
- **Fields (wlsm-save-stationary-issued-form):** Item: [select]; Quantity: [number]; Issue To; Student [radio]; Staff Member [radio]; Generate Invoice? [checkbox]; Class: [select]; Section: [select]; Student: [select]; Select Staff Member: [select]; Issue Date: [text]; Note: [textarea]
  - submit: Issue Item

### Add Gate Pass

`page=sm-staff-gate-passes&action=save`

- **Buttons:** All Gate Passes
- **Fields (wlsm-save-gate-pass-form):** Visitor Name: [text]; Mobile Number: [text]; Relation to Student: [text]; Visitor Photo; Upload Photo [file]; Class: [select]; Section: [select]; Student: [select]; Visit Date: [text]; In Time: [time]; Out Time: [time]; Authorized By: [text]; Reason to Meet (Optional): [textarea]
  - submit: Add Gate Pass
