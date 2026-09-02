import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  BookOpen,
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
  PenSquare,
  FileSpreadsheet,
  PenLine,
  ScrollText,
  Settings2,
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
      {
        title: "Fee setup",
        href: "/fees/setup",
        icon: Settings2,
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
