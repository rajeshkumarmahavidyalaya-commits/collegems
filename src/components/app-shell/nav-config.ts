import type { LucideIcon } from "lucide-react";
import { BookOpen, LayoutDashboard, ListChecks, Users } from "lucide-react";

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
