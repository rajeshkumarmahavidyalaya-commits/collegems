/**
 * English is the source catalogue: its keys are the contract, and every other
 * locale is typed as a `Partial` of it — which makes an incomplete translation
 * *representable* rather than a build error, and therefore reportable.
 *
 * That is the whole design. A catalogue that must be complete to compile is a
 * catalogue nobody adds a language to; a catalogue that may be incomplete and
 * says how incomplete is one somebody can finish over three afternoons.
 * `localeCoverage()` is the report, and a test fails when a locale slips below
 * what it had.
 *
 * Keys are flat and dotted, `area.thing`. Interpolation is `{name}`. A key that
 * needs a plural has `.one` and `.other` siblings and is read through
 * `t.plural` — English, Hindi and Urdu all use exactly those two categories,
 * and `Intl.PluralRules` decides which, so a language with more can be added
 * without touching a call site.
 */
export const en = {
  // --- the shell -----------------------------------------------------------
  "app.name": "SchoolOS",
  "app.skipToContent": "Skip to content",
  "app.search": "Search",
  "app.commandPalette": "Command palette",
  "app.navigation": "Navigation",
  "app.sidebar.expand": "Expand the sidebar",
  "app.sidebar.collapse": "Collapse the sidebar",
  "app.openNav": "Open the navigation menu",
  "app.theme.toggle": "Toggle theme",
  "app.theme.light": "Light",
  "app.theme.dark": "Dark",
  "app.theme.system": "System",
  "app.signOut": "Sign out",
  "app.signedInAs": "Signed in as {name}",
  "app.language": "Language",
  "app.language.choose": "Choose a language",
  "app.language.followSchool": "Follow the school ({name})",
  "app.language.saved": "Language changed to {name}.",

  // --- navigation ----------------------------------------------------------
  "nav.dashboard": "Dashboard",
  "nav.students": "Students",
  "nav.attendance": "Attendance",
  "nav.academics": "Academics",
  "nav.timetable": "Timetable",
  "nav.exams": "Exams",
  "nav.homework": "Homework",
  "nav.fees": "Fees",
  "nav.familyFees": "Fees",
  "nav.accounts": "Accounts",
  "nav.hr": "Staff",
  "nav.payroll": "Payroll",
  "nav.library": "Library",
  "nav.transport": "Transport",
  "nav.hostel": "Hostel",
  "nav.inventory": "Store",
  "nav.frontOffice": "Front office",
  "nav.notifications": "Notifications",
  "nav.reports": "Reports",
  "nav.checks": "Needs attention",
  "nav.settings": "Settings",
  "nav.overview": "Overview",
  "nav.people": "People",
  "nav.importStudents": "Import students",
  "nav.certificates": "Certificates",
  "nav.schedules": "Automatic messages",
  "nav.notices": "Notice board",
  "nav.studentLeave": "Student leave",
  "nav.cover": "Cover",
  "nav.schoolSettings": "School settings",
  "nav.concessions": "Concessions",
  "nav.classRoutine": "Class routine",
  "nav.myWeek": "My week",
  "nav.attendanceReport": "Attendance report",
  "nav.promotion": "Promotion",
  "nav.studyMaterial": "Study material",
  "nav.reportCards": "Report cards",
  "nav.busAssignments": "Bus assignments",
  "nav.staff": "Staff",
  "nav.academicYears": "Academic years",
  "nav.staffList": "Staff list",
  "nav.staffAttendance": "Staff attendance",
  "nav.leave": "Leave",
  "nav.salaryStructures": "Salary structures",
  "nav.finance": "Finance",
  "nav.feeCounter": "Fee counter",
  "nav.balances": "Balances",
  "nav.invoices": "Invoices",
  "nav.dayBook": "Day book",
  "nav.billingPeriods": "Billing periods",
  "nav.feeSetup": "Fee setup",
  "nav.voucherBook": "Voucher book",
  "nav.insight": "Insight",
  "nav.communication": "Communication",
  "nav.compose": "Compose",
  "nav.deliveryLog": "Delivery log",
  "nav.channels": "Channels",
  "nav.catalog": "Catalog",
  "nav.members": "Members",
  "nav.issuesReturns": "Issues & returns",

  // --- things every screen says -------------------------------------------
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.saved": "Saved",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.add": "Add",
  "common.close": "Close",
  "common.back": "Back",
  "common.next": "Next",
  "common.previous": "Previous",
  "common.confirm": "Confirm",
  "common.retry": "Try again",
  "common.loading": "Loading…",
  "common.none": "None",
  "common.all": "All",
  "common.yes": "Yes",
  "common.no": "No",
  "common.required": "Required",
  "common.optional": "Optional",
  "common.actions": "Actions",
  "common.status": "Status",
  "common.date": "Date",
  "common.name": "Name",
  "common.total": "Total",
  "common.notSet": "Not set",

  // --- states a list can be in --------------------------------------------
  "state.empty.title": "Nothing here yet",
  "state.error.title": "That did not load",
  "state.error.body": "Something went wrong on our side. Trying again usually works.",
  "state.noResults": "Nothing matched that search.",
  "state.showingOf.one": "Showing {shown} of {total} row",
  "state.showingOf.other": "Showing {shown} of {total} rows",
  "state.selected.one": "{count} selected",
  "state.selected.other": "{count} selected",

  // --- signing in ----------------------------------------------------------
  "login.title": "Sign in",
  "login.subtitle": "Use the address your school gave you.",
  "login.email": "Email address",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.submitting": "Signing in…",
  "login.forgot": "Forgotten your password?",
  "login.showPassword": "Show password",
  "login.brandHeadline": "One system for admissions, attendance, fees, and everything else that keeps a school running.",
  "login.brandSub": "Built for the people who run the school, not just the people who buy the software.",
  "login.copyright": "© {year} SchoolOS",
  "login.hidePassword": "Hide password",
  "login.failed": "That email address and password do not match.",
  "login.noTenant":
    "This login is not attached to a school yet. Ask your administrator to send you an invitation.",

  // --- notification channels, the newest screen and a full one ------------

  // The DataTable's own chrome. It is on roughly twenty list screens, and
  // every string in it was English until these keys existed.
  "table.loading": "Loading…",
  "table.noResults": "No results",
  "table.showing": "Showing {from}–{to} of {total}",
  "table.selected": "{count} of {total} selected",
  "table.rowsPerPage": "Rows per page",
  "table.pageOf": "Page {page} of {pages}",
  "table.firstPage": "First page",
  "table.previousPage": "Previous page",
  "table.nextPage": "Next page",
  "table.lastPage": "Last page",
  "table.search": "Search…",
  "table.clearSearch": "Clear search",
  "table.savedViews": "Saved views",
  "table.noSavedViews": "No saved views yet",
  "table.nameThisView": "Name this view",
  "table.save": "Save",
  "table.deleteView": "Delete the view {name}",
  "table.export": "Export",
  "table.columns": "Columns",
  "table.emptyTitle": "Nothing here yet",
  "table.emptyDescription": "Once records exist, they will show up here.",
  "table.errorTitle": "Couldn’t load this",
  "table.errorDescription": "Something went wrong at our end.",
  "table.retry": "Try again",
  "table.selectAll": "Select every row on this page",
  "table.selectRow": "Select this row",

  "channels.title": "Notification channels",
  "channels.subtitle":
    "Whether a message actually leaves the building has three parts: this build has to have a driver for the channel, the school has to have turned it on and given it an address, and the dispatcher has to have found its credentials.",
  "channels.sending": "Sending",
  "channels.holding": "Holding",
  "channels.noDriver": "No driver",
  "channels.waiting": "Waiting",
  "channels.failed": "Failed",
  "channels.sentThisWeek": "Sent this week",
  "channels.sendNow": "Send queued messages now",
  "channels.nothingWaiting": "Nothing is waiting to go out.",
  "channels.waitingCount.one": "{count} message is waiting to go out.",
  "channels.waitingCount.other": "{count} messages are waiting to go out.",
  "channels.retryFailed": "Retry {count} failed",
  "channels.fromAddress": "From address",
  "channels.senderNumber": "Sender number",
  "channels.senderName": "Sender name",
  "channels.saveSender": "Save sender",
  "channels.onForSchool": "On for this school",
  "channels.offForSchool": "Off for this school",
  "channels.devices": "Registered devices",
  "channels.devices.body":
    "Where a push notification would go. Tokens are never shown here or anywhere else — a push token is a capability, not an address, so only the counts are readable.",
  "channels.devices.none":
    "Nobody has registered a device yet, so every push message is kept rather than sent.",

  // --- a person's own settings --------------------------------------------
  "settings.language.title": "Language",
  "settings.language.body":
    "Which language this application speaks to you in. It changes nothing for anybody else, and it does not change the language a notification is written in — that is chosen by whoever sends it.",
  "settings.language.rtlNote":
    "Urdu is written right to left, and the whole interface turns around with it.",

  // --- the family's own screens -------------------------------------------
  // Rule 15 arriving in a module rather than in the chrome. This is the screen
  // a parent who chose Urdu is most likely to open, so it is the first module
  // copy in the catalogue rather than the last.
  "family.fees.title": "Fees",
  "family.fees.body":
    "What the school has billed for each of your children, and what is left to pay. Open a name for the bills, the receipts and every adjustment behind the figure.",
  "family.fees.owing": "Due",
  "family.fees.settled": "Settled",
  "family.fees.inCredit": "In credit",
  "family.fees.notBilled": "Not billed",
  "family.fees.nothingBilled": "Nothing billed this year yet",
  "family.fees.lastPayment": "Last payment {date}",
  "family.fees.noPaymentYet": "No payment received yet",
  "family.fees.footnote":
    "Figures are for the current academic year. A year left owing is shown on the account itself, so nothing is quietly written off.",
  "family.fees.noChildren.title": "No children linked to this login",
  "family.fees.noChildren.body":
    "Ask the school office to link your account to your child’s record. Until then there is no account for this page to show.",
  "family.fees.staff.title": "This page belongs to a family",
  "family.fees.staff.body":
    "It shows a parent or a student their own children’s accounts. To collect a payment or look up any child, use the fee counter.",

  // --- the notice board ----------------------------------------------------
  "notices.title": "Notice board",
  "notices.body":
    "Circulars and announcements, kept so they can be read again. You are only shown the ones addressed to you.",
  "notices.manage": "Write and manage notices",
  "notices.empty.title": "Nothing on the board",
  "notices.empty.staff":
    "Nothing has been published yet. A notice stays here after it is announced, so it can be read again.",
  "notices.empty.reader": "There are no notices for you at the moment.",
  "notices.writeFirst": "Write the first one",
  "notices.pinned": "Pinned",
  "notices.read": "Read",
  "notices.new": "New",
  "notices.attachments.one": "{count} attachment",
  "notices.attachments.other": "{count} attachments",
  "notices.category.general": "General",
  "notices.category.circular": "Circular",
  "notices.category.event": "Event",
  "notices.category.examination": "Examination",
  "notices.category.holiday": "Holiday",
  "notices.category.urgent": "Urgent",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Partial<Record<MessageKey, string>>;
