import Link from "next/link";
import {
  BookUp,
  ClipboardCheck,
  IndianRupee,
  ListTodo,
  Settings2,
  Sparkles,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { hasPermission } from "@/lib/auth/permissions";

type Action = { href: string; label: string; hint: string; icon: LucideIcon; permission: string | null };

/**
 * The few things each seat does most, one click from home. Each link is drawn
 * only when the caller holds the permission **its destination page checks**, so
 * a button never leads to a refusal (rule 4: the menu and the boundary must not
 * disagree). No role or tier branch: a college that grants a teacher
 * `fees.collect` gets the fee counter here the same afternoon.
 */
const ACTIONS: Action[] = [
  { href: "/assistant", label: "Ask SchoolOS", hint: "Any question, any report", icon: Sparkles, permission: null },
  { href: "/attendance", label: "Take register", hint: "Today's attendance", icon: ClipboardCheck, permission: "attendance.mark" },
  { href: "/fees/counter", label: "Collect a fee", hint: "Take a payment, print a receipt", icon: IndianRupee, permission: "fees.collect" },
  { href: "/students/new", label: "Admit a student", hint: "Add to the roll", icon: UserPlus, permission: "students.manage" },
  { href: "/library/issues", label: "Issue or return a book", hint: "Library counter", icon: BookUp, permission: "library.return" },
  { href: "/fees/setup", label: "Fees and student types", hint: "Regular, carry-over and others", icon: Settings2, permission: "fees.manage" },
  { href: "/academics/electives", label: "Elective subjects", hint: "What each class may choose", icon: ListTodo, permission: "academics.manage" },
  { href: "/settings/team", label: "Logins and invitations", hint: "Staff, students and parents", icon: Users, permission: "users.manage" },
];

export async function QuickActions({ extra = [] }: { extra?: Omit<Action, "permission">[] }) {
  const allowed = await Promise.all(ACTIONS.map((a) => (a.permission ? hasPermission(a.permission) : true)));
  const shown = [...ACTIONS.filter((_, i) => allowed[i]), ...extra];
  if (shown.length === 0) return null;

  return (
    <nav aria-label="Quick actions" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {shown.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <a.icon className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{a.label}</span>
            <span className="block truncate text-xs text-muted-foreground">{a.hint}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
