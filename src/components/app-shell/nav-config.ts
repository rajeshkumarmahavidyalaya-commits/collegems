import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BedDouble,
  Bell,
  BookOpen,
  Bus,
  MapPin,
  ClipboardCheck,
  GraduationCap,
  BookOpenCheck,
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
  PenLine,
  ScrollText,
  Settings2,
  ArrowUpNarrowWide,
  Users,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  roles?: string[]; // omit = every role
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [{ title: "Dashboard", href: "/", icon: LayoutDashboard }],
  },
  {
    title: "People",
    items: [
      {
        title: "Students",
        href: "/students",
        icon: GraduationCap,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
    ],
  },
  {
    title: "Academics",
    items: [
      {
        title: "Academics",
        href: "/academics",
        icon: Library,
        roles: ["admin", "teacher", "accountant"],
      },
      {
        title: "Class routine",
        href: "/timetable",
        icon: CalendarRange,
      },
      {
        title: "My week",
        href: "/timetable/me",
        icon: CalendarClock,
        roles: ["admin", "teacher"],
      },
      {
        title: "Attendance",
        href: "/attendance",
        icon: ClipboardCheck,
        roles: ["admin", "teacher"],
      },
      {
        title: "Attendance report",
        href: "/attendance/report",
        icon: BarChart3,
        roles: ["admin", "teacher", "accountant"],
      },
      {
        title: "Exams",
        href: "/exams",
        icon: PenSquare,
        roles: ["admin", "teacher"],
      },
      {
        title: "Promotion",
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
        href: "/homework",
        icon: NotebookPen,
      },
      {
        title: "Study material",
        href: "/study-material",
        icon: FolderOpen,
      },
      // The family's own cards. Staff reach a class's cards from the exam
      // itself, because printing is something you do to a class, not to the
      // school -- so this entry is only for the people who have exactly one
      // card to look at.
      {
        title: "Report cards",
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
        href: "/transport",
        icon: Bus,
        roles: ["admin", "teacher", "accountant"],
      },
      {
        title: "Bus assignments",
        href: "/transport/assignments",
        icon: MapPin,
        roles: ["admin"],
      },
      {
        title: "Hostel",
        href: "/hostel",
        icon: BedDouble,
        roles: ["admin", "teacher", "accountant"],
      },
    ],
  },
  {
    title: "Staff",
    items: [
      {
        title: "Staff attendance",
        href: "/hr",
        icon: CalendarCheck,
        roles: ["admin", "teacher", "accountant", "librarian"],
      },
      // No `roles` filter: everybody employed here has leave, and hiding the
      // screen from the people who take it is how a form ends up on paper.
      { title: "Leave", href: "/hr/leave", icon: Plane },
      {
        title: "Salary structures",
        href: "/hr/salary",
        icon: Sigma,
        roles: ["admin", "accountant"],
      },
      // No `roles` filter, same reason as `/homework`: one address, two
      // screens. A teacher gets their own payslips here, an accountant gets
      // the runs.
      { title: "Payroll", href: "/payroll", icon: Wallet },
    ],
  },
  {
    title: "Finance",
    items: [
      {
        title: "Fee counter",
        href: "/fees/counter",
        icon: IndianRupee,
        roles: ["admin", "accountant"],
      },
      {
        title: "Balances",
        href: "/fees",
        icon: BarChart3,
        roles: ["admin", "accountant"],
      },
      {
        title: "Invoices",
        href: "/fees/invoices",
        icon: FileText,
        roles: ["admin", "accountant"],
      },
      {
        title: "Day book",
        href: "/fees/daybook",
        icon: BookOpenCheck,
        roles: ["admin", "accountant"],
      },
      // Sits next to fee setup because it is the other half of the same
      // configuration: the structure says what a class pays, the calendar says
      // when each of those is collected. Neither is any use alone.
      {
        title: "Billing periods",
        href: "/fees/instalments",
        icon: CalendarRange,
        roles: ["admin", "accountant"],
      },
      {
        title: "Fee setup",
        href: "/fees/setup",
        icon: Settings2,
        roles: ["admin", "accountant"],
      },
      // The general ledger. RLS restricts every accounts table to these two
      // roles anyway; the filter keeps the menu honest rather than offering a
      // page that would render empty.
      {
        title: "Accounts",
        href: "/accounts",
        icon: Landmark,
        roles: ["admin", "accountant"],
      },
      {
        title: "Voucher book",
        href: "/accounts/vouchers",
        icon: BookText,
        roles: ["admin", "accountant"],
      },
    ],
  },
  {
    title: "Insight",
    items: [
      // No `roles` filter: `report_list` already narrows the catalog to what a
      // role may run, so a librarian sees the two reports they can run rather
      // than a menu item that leads to an empty page.
      { title: "Reports", href: "/reports", icon: FileSpreadsheet },
    ],
  },
  {
    title: "Communication",
    items: [
      // No `roles` filter: every account has an inbox, and hiding it from
      // students and parents is exactly how a "we told you" message ends up
      // nowhere.
      { title: "Notifications", href: "/notifications", icon: Bell },
      {
        title: "Compose",
        href: "/notifications/compose",
        icon: PenLine,
        roles: ["admin"],
      },
      {
        title: "Delivery log",
        href: "/notifications/log",
        icon: ScrollText,
        roles: ["admin"],
      },
    ],
  },
  {
    title: "Library",
    items: [
      { title: "Catalog", href: "/library/books", icon: BookOpen },
      {
        title: "Members",
        href: "/library/members",
        icon: Users,
        roles: ["admin", "librarian", "teacher", "accountant"],
      },
      {
        title: "Issues & returns",
        href: "/library/issues",
        icon: ListChecks,
        roles: ["admin", "librarian", "teacher", "accountant"],
      },
    ],
  },
];

export function navForRole(roleCode: string): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(roleCode)),
  })).filter((group) => group.items.length > 0);
}
