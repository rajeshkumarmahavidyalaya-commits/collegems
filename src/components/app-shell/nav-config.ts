import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  BookOpenCheck,
  IndianRupee,
  LayoutDashboard,
  ListChecks,
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
