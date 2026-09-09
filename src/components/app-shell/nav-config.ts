import type { LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages/en";
import {
  BarChart3,
  BedDouble,
  CreditCard,
  UserPlus,
  Bell,
  BookOpen,
  Bus,
  MapPin,
  ClipboardCheck,
  DoorOpen,
  GraduationCap,
  BookOpenCheck,
  Boxes,
  CalendarClock,
  CalendarRange,
  FileText,
  Library,
  IndianRupee,
  LayoutDashboard,
  ListChecks,
  NotebookPen,
  CalendarCheck,
  Plane,
  Wallet,
  Landmark,
  BookText,
  Sigma,
  FolderOpen,
  PenSquare,
  FileSpreadsheet,
  FileUp,
  PenLine,
  Radio,
  ScrollText,
  FileBadge,
  AlarmClock,
  ClipboardList,
  CalendarOff,
  Settings2,
  ShieldAlert,
  Languages,
  ArrowUpNarrowWide,
  Users,
  UserCheck,
  BadgePercent,
} from "lucide-react";

export type NavItem = {
  /**
   * The English label, kept as the fallback and as the thing a reader of this
   * file recognises. `messageKey` is what actually renders — leaving both here
   * means a new entry works before its translation exists, which is the same
   * bargain the message catalogue makes everywhere else.
   */
  title: string;
  messageKey?: MessageKey;
  href: string;
  icon: LucideIcon;
  roles?: string[]; // omit = every role
};

export type NavGroup = {
  title: string;
  messageKey?: MessageKey;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    messageKey: "nav.overview",
    items: [{ title: "Dashboard",
 messageKey: "nav.dashboard", href: "/", icon: LayoutDashboard }],
  },
  {
    title: "People",
    messageKey: "nav.people",
    items: [
      {
        title: "Students",
        messageKey: "nav.students",
        href: "/students",
        icon: GraduationCap,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
      // Before a student exists. An enquiry holds a child's date of birth and a
      // family's phone number before either has any relationship with the
      // school, so RLS keeps the whole module to the office and the menu says
      // the same.
      {
        title: "Front office",
        messageKey: "nav.frontOffice",
        href: "/front-office",
        icon: DoorOpen,
        roles: ["admin", "accountant"],
      },
      {
        title: "Import students",
        messageKey: "nav.importStudents",
        href: "/students/import",
        icon: FileUp,
        roles: ["admin"],
      },
      // Certificates sit with People rather than under Reports: a leaving
      // certificate is an act performed on a child's record -- it takes them
      // off the roll -- and not a way of looking something up. The register
      // report is separately in the catalog for the auditor.
      {
        title: "Certificates",
        messageKey: "nav.certificates",
        href: "/certificates",
        icon: FileBadge,
        roles: ["admin", "teacher", "accountant"],
      },
    ],
  },
  {
    title: "Academics",
    messageKey: "nav.academics",
    items: [
      {
        title: "Academics",
        messageKey: "nav.academics",
        href: "/academics",
        icon: Library,
        roles: ["admin", "teacher", "accountant"],
      },
      // The year everything is filed under, and the only place the flag that
      // decides it can be moved. Its own entry rather than a card on
      // /academics: `reference.checks` links straight here, and a critic whose
      // link lands on a page where you then have to hunt is one people stop
      // following.
      {
        title: "Academic years",
        messageKey: "nav.academicYears",
        href: "/academics/sessions",
        icon: CalendarRange,
        roles: ["admin"],
      },
      {
        title: "Class routine",
        messageKey: "nav.classRoutine",
        href: "/timetable",
        icon: CalendarRange,
      },
      {
        title: "My week",
        messageKey: "nav.myWeek",
        href: "/timetable/me",
        icon: CalendarClock,
        roles: ["admin", "teacher"],
      },
      // Staff only, and deliberately not admin-only: a teacher opening this
      // sees what *they* are covering, which is the half of the question a
      // paper roster on a noticeboard answers badly. The office's half — who
      // is away, who is free — is gated inside the page on
      // `substitutions.manage`, because it is built on a table a teacher
      // cannot read across. See migration 0158.
      {
        title: "Cover",
        messageKey: "nav.cover",
        href: "/timetable/substitutions",
        icon: UserCheck,
        roles: ["admin", "teacher"],
      },
      {
        title: "Attendance",
        messageKey: "nav.attendance",
        href: "/attendance",
        icon: ClipboardCheck,
        roles: ["admin", "teacher"],
      },
      // No `roles`: a family asks for leave and a teacher decides it, so every
      // role has business here. RLS narrows what each of them sees to their own
      // children, their own section, or the school.
      {
        title: "Student leave",
        messageKey: "nav.studentLeave",
        href: "/attendance/leave",
        icon: CalendarOff,
      },
      {
        title: "Attendance report",
        messageKey: "nav.attendanceReport",
        href: "/attendance/report",
        icon: BarChart3,
        roles: ["admin", "teacher", "accountant"],
      },
      {
        title: "Exams",
        messageKey: "nav.exams",
        href: "/exams",
        icon: PenSquare,
        roles: ["admin", "teacher"],
      },
      {
        title: "Promotion",
        messageKey: "nav.promotion",
        href: "/promotion",
        icon: ArrowUpNarrowWide,
        roles: ["admin"],
      },
      // No `roles` filter on either: `/homework` is two screens behind one
      // address -- a teacher's list of what they set, a family's list of what
      // they have to do -- and telling a parent to visit a different URL from
      // their child is exactly the kind of thing that gets a product ignored.
      {
        title: "Homework",
        messageKey: "nav.homework",
        href: "/homework",
        icon: NotebookPen,
      },
      {
        title: "Study material",
        messageKey: "nav.studyMaterial",
        href: "/study-material",
        icon: FolderOpen,
      },
      // The family's own cards. Staff reach a class's cards from the exam
      // itself, because printing is something you do to a class, not to the
      // school -- so this entry is only for the people who have exactly one
      // card to look at.
      {
        title: "Report cards",
        messageKey: "nav.reportCards",
        href: "/report-card",
        icon: ScrollText,
        roles: ["parent", "student"],
      },
      // Transport sits with the academic group rather than with fees, because
      // the question people bring to it is "which bus does my child take", not
      // "what does it cost". No `roles` filter on the routes screen: staff see
      // the fleet, and a family reaching it sees only their own arrangement,
      // which RLS decides rather than the menu.
      {
        title: "Transport",
        messageKey: "nav.transport",
        href: "/transport",
        icon: Bus,
        roles: ["admin", "teacher", "accountant"],
      },
      {
        title: "Bus assignments",
        messageKey: "nav.busAssignments",
        href: "/transport/assignments",
        icon: MapPin,
        roles: ["admin"],
      },
      {
        title: "Hostel",
        messageKey: "nav.hostel",
        href: "/hostel",
        icon: BedDouble,
        roles: ["admin", "teacher", "accountant"],
      },
    ],
  },
  {
    title: "Staff",
    messageKey: "nav.staff",
    items: [
      // The roster itself, and the only surface `staff_exit` has. Gated on
      // `staff.view` inside `staff_roster` rather than here — this `roles`
      // filter is a menu, not a boundary, and the two must not disagree about
      // who may look.
      {
        title: "Staff list",
        messageKey: "nav.staffList",
        href: "/staff",
        icon: Users,
        roles: ["admin"],
      },
      {
        title: "Staff attendance",
        messageKey: "nav.staffAttendance",
        href: "/hr",
        icon: CalendarCheck,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
      // Everybody *employed here* has leave, and hiding the screen from the
      // people who take it is how a form ends up on paper. That sentence stood
      // here with no `roles` list under it, so it also reached a parent: signed
      // in as a guardian this page renders the heading "Leave" over the words
      // "Your leave, and what is left of each kind. Only unpaid leave reaches a
      // payslip" and an empty board. The list is the sentence, written down.
      {
        title: "Leave",
        messageKey: "nav.leave",
        href: "/hr/leave",
        icon: Plane,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
      {
        title: "Salary structures",
        messageKey: "nav.salaryStructures",
        href: "/hr/salary",
        icon: Sigma,
        roles: ["admin", "accountant"],
      },
      // One address, two screens, same as `/homework`: a teacher gets their own
      // payslips here and an accountant gets the runs. Both halves are about a
      // person the school pays -- so the roles list is what the second screen
      // already assumed. Without it a guardian's menu offered them "Payroll",
      // which renders "My pay -- what you were paid, month by month" to
      // somebody the school does not employ.
      {
        title: "Payroll",
        messageKey: "nav.payroll",
        href: "/payroll",
        icon: Wallet,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
    ],
  },
  {
    title: "Finance",
    messageKey: "nav.finance",
    items: [
      // The family's door into this module, and the only entry in the group a
      // family sees. Everything behind it was already readable -- a parent
      // holds `fees.view`, `fees_student_balances()` is row-scoped to their own
      // children, and `/fees/students/[id]` has always rendered read-only for
      // anybody without `fees.collect`. What was missing was the link: eight
      // fee screens, all of them `roles: ["admin", "accountant"]`, and a
      // dashboard card quoting a total with nowhere to go from it.
      {
        title: "Fees",
        messageKey: "nav.familyFees",
        href: "/fees/family",
        icon: IndianRupee,
        roles: ["student", "parent"],
      },
      {
        title: "Fee counter",
        messageKey: "nav.feeCounter",
        href: "/fees/counter",
        icon: IndianRupee,
        roles: ["admin", "accountant"],
      },
      {
        title: "Balances",
        messageKey: "nav.balances",
        href: "/fees",
        icon: BarChart3,
        roles: ["admin", "accountant"],
      },
      {
        title: "Invoices",
        messageKey: "nav.invoices",
        href: "/fees/invoices",
        icon: FileText,
        roles: ["admin", "accountant"],
      },
      {
        title: "Day book",
        messageKey: "nav.dayBook",
        href: "/fees/daybook",
        icon: BookOpenCheck,
        roles: ["admin", "accountant"],
      },
      // Sits next to fee setup because it is the other half of the same
      // configuration: the structure says what a class pays, the calendar says
      // when each of those is collected. Neither is any use alone.
      {
        title: "Billing periods",
        messageKey: "nav.billingPeriods",
        href: "/fees/instalments",
        icon: CalendarRange,
        roles: ["admin", "accountant"],
      },
      // A teacher gets `concessions.view` but not the menu entry: they meet a
      // concession while looking at one child's account, not by browsing the
      // school's whole discount policy.
      {
        title: "Concessions",
        messageKey: "nav.concessions",
        href: "/fees/concessions",
        icon: BadgePercent,
        roles: ["admin", "accountant"],
      },
      {
        title: "Fee setup",
        messageKey: "nav.feeSetup",
        href: "/fees/setup",
        icon: Settings2,
        roles: ["admin", "accountant"],
      },
      // The general ledger. RLS restricts every accounts table to these two
      // roles anyway; the filter keeps the menu honest rather than offering a
      // page that would render empty.
      {
        title: "Accounts",
        messageKey: "nav.accounts",
        href: "/accounts",
        icon: Landmark,
        roles: ["admin", "accountant"],
      },
      {
        title: "Voucher book",
        messageKey: "nav.voucherBook",
        href: "/accounts/vouchers",
        icon: BookText,
        roles: ["admin", "accountant"],
      },
      // The store sits in Finance rather than with the academic modules: what
      // people ask of it is "what did we spend and what is left", and the
      // librarian is in here because in most schools the store keeper and the
      // librarian are the same person.
      {
        title: "Store",
        messageKey: "nav.inventory",
        href: "/inventory",
        icon: Boxes,
        roles: ["admin", "accountant", "librarian", "teacher"],
      },
    ],
  },
  {
    title: "Insight",
    messageKey: "nav.insight",
    items: [
      // No `roles` filter: `report_list` already narrows the catalog to what a
      // role may run, so a librarian sees the two reports they can run rather
      // than a menu item that leads to an empty page.
      { title: "Reports",
 messageKey: "nav.reports", href: "/reports", icon: FileSpreadsheet },
      // `checks_run()` gates every check on the matrix and names the ones it
      // withheld, which is why a *staff* role with a narrow matrix still gets
      // this entry: a page saying "your role does not see this" is more use
      // than a menu item that vanished. See migration 0188.
      //
      // A family is not that case. Measured as a guardian: one of the nine
      // checks ran -- `fees.billing`, about the school's own fee-head setup --
      // and eight were withheld, so the screen was eight refusals and one
      // finding a parent can do nothing about. Migration 0200 moves that
      // check's permission to `fees.collect` for the reason 0189 gave, and the
      // list here says who the screen is for.
      //
      // The difference between a teacher and a parent here is not the count.
      // On the demo matrix a teacher and a librarian run **0 of 9** too, and
      // they keep the entry: a school can give a teacher `students.manage` and
      // the page fills in, which is a matrix decision it may revisit any
      // Tuesday. Nobody gives a guardian `staff.manage`. Where the count is a
      // problem it is the matrix's to fix, and the page names every check it
      // withheld so it is visible there rather than here.
      {
        title: "Needs attention",
        messageKey: "nav.checks",
        href: "/checks",
        icon: ShieldAlert,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
    ],
  },
  {
    title: "Communication",
    messageKey: "nav.communication",
    items: [
      // No `roles` filter: every account has an inbox, and hiding it from
      // students and parents is exactly how a "we told you" message ends up
      // nowhere.
      { title: "Notifications",
 messageKey: "nav.notifications", href: "/notifications", icon: Bell },
      {
        title: "Compose",
        messageKey: "nav.compose",
        href: "/notifications/compose",
        icon: PenLine,
        roles: ["admin"],
      },
      {
        title: "Delivery log",
        messageKey: "nav.deliveryLog",
        href: "/notifications/log",
        icon: ScrollText,
        roles: ["admin"],
      },
      {
        title: "Channels",
        messageKey: "nav.channels",
        href: "/notifications/channels",
        icon: Radio,
        roles: ["admin"],
      },
      // The only screen in this group that sends without anybody pressing
      // anything, which is why an accountant may look at it and only an
      // administrator may switch one on.
      {
        title: "Automatic messages",
        messageKey: "nav.schedules",
        href: "/notifications/schedules",
        icon: AlarmClock,
        roles: ["admin", "accountant"],
      },
      // No `roles` at all: the notice board is for everybody, and *which*
      // notices somebody sees is the RLS policy's business rather than the
      // menu's. A nav entry that guessed at the audience would be a second
      // answer to a question Postgres already answers.
      {
        title: "Notice board",
        messageKey: "nav.notices",
        href: "/notices",
        icon: ClipboardList,
      },
    ],
  },
  {
    title: "Library",
    messageKey: "nav.library",
    items: [
      { title: "Catalog",
 messageKey: "nav.catalog", href: "/library/books", icon: BookOpen },
      {
        title: "Members",
        messageKey: "nav.members",
        href: "/library/members",
        icon: Users,
        roles: ["admin", "librarian", "teacher", "accountant"],
      },
      {
        title: "Issues & returns",
        messageKey: "nav.issuesReturns",
        href: "/library/issues",
        icon: ListChecks,
        roles: ["admin", "librarian", "teacher", "accountant"],
      },
    ],
  },
  {
    // No `roles` filter anywhere in this group: which language the application
    // speaks to somebody is theirs to choose, whatever they are here to do.
    title: "Settings",
    messageKey: "nav.settings",
    items: [
      // Not every role, though `settings` is readable by every tenant member
      // and the page renders read-only without `settings.manage`. These are the
      // three who act on a setting's consequences -- a librarian wants to know
      // the fine rate, an accountant whether online payments are on. A parent
      // has no question this screen answers.
      {
        title: "School settings",
        messageKey: "nav.schoolSettings",
        href: "/settings/school",
        icon: Settings2,
        roles: ["admin", "accountant", "librarian"],
      },
      // Who may sign in to this school. Admin only, and that is not a menu
      // decision -- `invitations` has carried an admin-only policy since
      // migration 0005, so the two agree rather than the menu guessing.
      {
        title: "People and invitations",
        messageKey: "nav.team",
        href: "/settings/team",
        icon: UserPlus,
        roles: ["admin"],
      },
      // The plan is readable by every member of the school by policy, but the
      // people who act on a ceiling are the ones who admit children and hire
      // staff. A teacher is a candidate for neither.
      {
        title: "Plan",
        messageKey: "nav.plan",
        href: "/settings/plan",
        icon: CreditCard,
        roles: ["admin", "accountant"],
      },
      { title: "Language", messageKey: "app.language", href: "/settings/language", icon: Languages },
    ],
  },
];

export function navForRole(roleCode: string): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(roleCode)),
  })).filter((group) => group.items.length > 0);
}
