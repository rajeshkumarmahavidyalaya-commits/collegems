import type { LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages/en";
import {
  BarChart3,
  BedDouble,
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
  Languages,
  ArrowUpNarrowWide,
  Users,
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
      {
        title: "Staff attendance",
        messageKey: "nav.staffAttendance",
        href: "/hr",
        icon: CalendarCheck,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
      // No `roles` filter: everybody employed here has leave, and hiding the
      // screen from the people who take it is how a form ends up on paper.
      { title: "Leave",
 messageKey: "nav.leave", href: "/hr/leave", icon: Plane },
      {
        title: "Salary structures",
        messageKey: "nav.salaryStructures",
        href: "/hr/salary",
        icon: Sigma,
        roles: ["admin", "accountant"],
      },
      // No `roles` filter, same reason as `/homework`: one address, two
      // screens. A teacher gets their own payslips here, an accountant gets
      // the runs.
      { title: "Payroll",
 messageKey: "nav.payroll", href: "/payroll", icon: Wallet },
    ],
  },
  {
    title: "Finance",
    messageKey: "nav.finance",
    items: [
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
    items: [{ title: "Language", messageKey: "app.language", href: "/settings/language", icon: Languages }],
  },
];

export function navForRole(roleCode: string): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(roleCode)),
  })).filter((group) => group.items.length > 0);
}
