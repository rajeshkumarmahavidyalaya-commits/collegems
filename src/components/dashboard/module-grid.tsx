import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BedDouble,
  BookOpen,
  Bus,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileBadge,
  GraduationCap,
  IndianRupee,
  KeyRound,
  Landmark,
  Megaphone,
  NotebookPen,
  Package,
  PenLine,
  Plus,
  School,
  Settings,
  TriangleAlert,
  UserCheck,
  UserRoundPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatMonth } from "@/lib/i18n/format";
import {
  MODULE_TILES,
  attentionLine,
  parseModuleOverview,
  tileLine,
  type ModuleEntry,
} from "@/lib/validations/modules";

const ICONS: Record<string, LucideIcon> = {
  students: GraduationCap,
  staff: Users,
  classes: School,
  timetable: CalendarDays,
  attendance: ClipboardCheck,
  student_leave: ClipboardList,
  front_office: UserRoundPlus,
  fees: IndianRupee,
  exams: PenLine,
  homework: NotebookPen,
  library: BookOpen,
  transport: Bus,
  hostel: BedDouble,
  notices: Megaphone,
  staff_attendance: UserCheck,
  payroll: Wallet,
  accounts: Landmark,
  inventory: Package,
  certificates: FileBadge,
  reports: BarChart3,
  logins: KeyRound,
  settings: Settings,
};

/**
 * Every module on one screen (0290): a tile per module the caller may open,
 * its count, what needs doing today, and its main action one click away.
 *
 * Which tiles exist and whether the action is drawn both come from
 * `module_overview()`, gated on the permission each module's own page reads --
 * so a tile never opens onto a refusal and there is no role list here (rule 4).
 *
 * `fromBrief` carries the two numbers `dashboard_summary()` on the same page
 * already computed (receipts today, staff marked), so they are not paid for
 * twice and cannot disagree with the card beside them (0291).
 */
export async function ModuleGrid({
  fromBrief,
}: {
  fromBrief: Record<string, { count: number | null; total?: number | null }>;
}) {
  const supabase = await createClient();
  const [{ data, error }, t, locale] = await Promise.all([
    supabase.rpc("module_overview"),
    getT(),
    getLocale(),
  ]);
  if (error) return null;

  const entries: ModuleEntry[] = parseModuleOverview(data).map((e) => {
    const b = fromBrief[e.key];
    return b ? { ...e, count: e.count ?? b.count, total: e.total ?? b.total ?? null } : e;
  });
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="modules-heading" className="flex flex-col gap-3">
      <h2 id="modules-heading" className="text-base font-semibold">
        Everything in one place
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {entries.map((e) => {
          const tile = MODULE_TILES[e.key];
          const Icon = ICONS[e.key] ?? ClipboardList;
          const title = t(tile.titleKey);
          const line = tileLine(e, (iso) => formatMonth(iso, locale));
          const alert = attentionLine(e);
          return (
            <li
              key={e.key}
              className="relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary/40"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  {/* The title's link covers the tile; the action below sits above it. */}
                  <Link
                    href={tile.href}
                    className="font-medium after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
                  >
                    {title}
                  </Link>
                  {line && <p className="text-sm text-muted-foreground">{line}</p>}
                  {alert && (
                    <p className="mt-0.5 flex items-center gap-1 text-sm font-medium text-warning">
                      <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                      {alert}
                    </p>
                  )}
                </div>
              </div>
              {tile.action && e.canAct && (
                <Link
                  href={tile.action.href}
                  className="relative z-10 inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {tile.action.add ? (
                    <Plus className="size-3.5" aria-hidden="true" />
                  ) : (
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  )}
                  {tile.action.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
