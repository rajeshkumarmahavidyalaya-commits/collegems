/**
 * The home page's module grid (0290): one tile per module, a count on each, and
 * the module's main action one click away -- the shape of the WordPress school
 * plugins a school office already knows.
 *
 * **Which tiles appear is decided in Postgres, not here.** `module_overview()`
 * returns an entry only for a module the caller may open, gated on the
 * permission the module's own page reads, and says whether they may take its
 * main action. This file only knows how to *draw* a module: its title, its
 * address, the words around its number. `MODULE_TILES` is keyed by the
 * function's keys, and a key it does not know is not drawn -- a tile with no
 * address would be a button to nowhere.
 *
 * Type imports only, deliberately: the tests read it without a database, and
 * one `import { z }` would make it the thing `fees-display.ts` was split away
 * from. A type import is erased and costs the bundle nothing.
 */

import type { MessageKey } from "@/lib/i18n/messages/en";

export type ModuleEntry = {
  key: string;
  count: number | null;
  total: number | null;
  attention: number | null;
  canAct: boolean;
  lastMonth: string | null;
};

export type ModuleTile = {
  /** A nav message key, so a tile and its menu entry read the same in every language. */
  titleKey: MessageKey;
  href: string;
  /** The permission `module_overview()` gates the tile on -- written here so a test can compare. */
  gate: string;
  /** `add` draws a plus: it creates something. Otherwise it goes to a task. */
  action: { label: string; href: string; add?: boolean } | null;
  /** The count as a phrase, singular and plural carried whole (rule 2, 0196). */
  noun: [string, string] | null;
  /** What `attention` means for this module, both forms. */
  attention: [string, string] | null;
};

export const MODULE_TILES: Record<string, ModuleTile> = {
  students: {
    titleKey: "nav.students", href: "/students", gate: "students.view",
    action: { label: "Admit a student", href: "/students/new", add: true },
    noun: ["student on roll", "students on roll"], attention: null,
  },
  staff: {
    titleKey: "nav.staffList", href: "/staff", gate: "staff.view",
    action: { label: "Add staff", href: "/staff/new", add: true },
    noun: ["member of staff", "members of staff"], attention: null,
  },
  classes: {
    titleKey: "nav.academics", href: "/academics?tab=classes", gate: "academics.view",
    action: { label: "Add a class", href: "/academics?tab=classes", add: true },
    noun: ["class this year", "classes this year"], attention: null,
  },
  timetable: {
    titleKey: "nav.classRoutine", href: "/timetable", gate: "academics.view",
    action: { label: "Edit timetable", href: "/timetable" },
    noun: ["lesson a week", "lessons a week"], attention: null,
  },
  attendance: {
    titleKey: "nav.attendance", href: "/attendance", gate: "attendance.mark",
    action: { label: "Take register", href: "/attendance" },
    noun: null, attention: ["register not taken today", "registers not taken today"],
  },
  student_leave: {
    titleKey: "nav.studentLeave", href: "/attendance/leave", gate: "leave.decide",
    action: { label: "Decide requests", href: "/attendance/leave" },
    noun: ["request waiting", "requests waiting"], attention: null,
  },
  front_office: {
    titleKey: "nav.frontOffice", href: "/front-office", gate: "frontoffice.view",
    action: { label: "New enquiry", href: "/front-office?new=enquiry", add: true },
    noun: ["open enquiry", "open enquiries"],
    attention: ["follow-up due", "follow-ups due"],
  },
  fees: {
    titleKey: "nav.feeCounter", href: "/fees", gate: "fees.collect",
    action: { label: "Collect a fee", href: "/fees/counter" },
    noun: ["receipt today", "receipts today"], attention: null,
  },
  exams: {
    titleKey: "nav.exams", href: "/exams", gate: "exams.view",
    action: { label: "Open exams", href: "/exams" },
    noun: ["exam this year", "exams this year"],
    attention: ["still a draft", "still drafts"],
  },
  homework: {
    titleKey: "nav.homework", href: "/homework", gate: "homework.manage",
    action: { label: "Set homework", href: "/homework", add: true },
    noun: ["piece set this year", "pieces set this year"],
    attention: ["due this week", "due this week"],
  },
  library: {
    titleKey: "nav.library", href: "/library/issues", gate: "library.view",
    action: { label: "Issue a book", href: "/library/issues?issue=1", add: true },
    noun: ["book out", "books out"], attention: ["overdue", "overdue"],
  },
  transport: {
    titleKey: "nav.transport", href: "/transport", gate: "transport.view",
    action: { label: "Assign a seat", href: "/transport/assignments", add: true },
    noun: ["seat in use", "seats in use"], attention: null,
  },
  hostel: {
    titleKey: "nav.hostel", href: "/hostel", gate: "hostel.view",
    action: { label: "Allocate a bed", href: "/hostel", add: true },
    noun: ["bed occupied", "beds occupied"], attention: null,
  },
  notices: {
    titleKey: "nav.notices", href: "/notices", gate: "notices.view",
    action: { label: "Post a notice", href: "/notices/manage", add: true },
    noun: ["notice up", "notices up"], attention: null,
  },
  staff_attendance: {
    titleKey: "nav.staffAttendance", href: "/hr", gate: "hr.view",
    action: { label: "Mark staff", href: "/hr" },
    noun: null, attention: ["leave request waiting", "leave requests waiting"],
  },
  payroll: {
    titleKey: "nav.payroll", href: "/payroll", gate: "payroll.process",
    action: { label: "Run payroll", href: "/payroll" },
    noun: null, attention: null,
  },
  accounts: {
    titleKey: "nav.accounts", href: "/accounts", gate: "accounts.view",
    action: { label: "Post a voucher", href: "/accounts", add: true },
    noun: ["voucher posted this month", "vouchers posted this month"],
    attention: ["draft waiting", "drafts waiting"],
  },
  inventory: {
    titleKey: "nav.inventory", href: "/inventory", gate: "inventory.view",
    action: { label: "Record stock", href: "/inventory", add: true },
    noun: ["item stocked", "items stocked"], attention: null,
  },
  certificates: {
    titleKey: "nav.certificates", href: "/certificates", gate: "certificates.view",
    action: { label: "Issue a certificate", href: "/certificates/issue", add: true },
    noun: ["issued this year", "issued this year"], attention: null,
  },
  reports: {
    titleKey: "nav.reports", href: "/reports", gate: "reports.view",
    action: null, noun: null, attention: null,
  },
  logins: {
    titleKey: "nav.team", href: "/settings/team", gate: "users.manage",
    action: { label: "Invite", href: "/settings/team", add: true },
    noun: ["login", "logins"], attention: ["invitation pending", "invitations pending"],
  },
  settings: {
    titleKey: "nav.schoolSettings", href: "/settings/school", gate: "settings.manage",
    action: null, noun: null, attention: null,
  },
};

/** The order a school office reads them in: people, the day, money, the rest. */
export const MODULE_ORDER = [
  "students", "staff", "attendance", "fees", "front_office", "classes",
  "timetable", "exams", "homework", "student_leave", "staff_attendance",
  "library", "transport", "hostel", "notices", "certificates", "payroll",
  "accounts", "inventory", "reports", "logins", "settings",
] as const;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Reads `module_overview()` defensively; an unrecognised shape is no modules, not a crash. */
export function parseModuleOverview(data: unknown): ModuleEntry[] {
  const modules = (data as { modules?: unknown } | null)?.modules;
  if (!Array.isArray(modules)) return [];
  const out: ModuleEntry[] = [];
  for (const m of modules) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    if (typeof r.key !== "string") continue;
    out.push({
      key: r.key,
      count: num(r.count),
      total: num(r.total),
      attention: num(r.attention),
      canAct: r.can_act === true,
      lastMonth: typeof r.last_month === "string" ? r.last_month : null,
    });
  }
  const rank = (k: string) => {
    const i = (MODULE_ORDER as readonly string[]).indexOf(k);
    return i === -1 ? MODULE_ORDER.length : i;
  };
  return out.filter((e) => MODULE_TILES[e.key]).sort((a, b) => rank(a.key) - rank(b.key));
}

/** "1 student on roll", "302 students on roll"; null when there is no count to say. */
export function countPhrase(n: number | null, forms: [string, string] | null): string | null {
  if (n === null || forms === null) return null;
  return `${n} ${n === 1 ? forms[0] : forms[1]}`;
}

/**
 * The line under a tile's title. Attendance and staff attendance say "x of y",
 * because a register count without the roll it is out of is the rate-hides-the-
 * measurement mistake (rule 12) in miniature.
 */
export function tileLine(e: ModuleEntry, month: (iso: string) => string = (iso) => iso.slice(0, 7)): string | null {
  const tile = MODULE_TILES[e.key];
  if (!tile) return null;
  if (e.key === "attendance" || e.key === "staff_attendance") {
    if (e.count === null || e.total === null) return null;
    const noun = e.key === "attendance" ? "classes" : "staff";
    return `${e.count} of ${e.total} ${noun} marked today`;
  }
  if (e.key === "payroll") {
    // The month through the caller's formatter (rule 15): never a locale here.
    return e.lastMonth ? `Last paid: ${month(e.lastMonth)}` : "Not run yet";
  }
  return countPhrase(e.count, tile.noun);
}

/** The amber line, only when there is something to act on. */
export function attentionLine(e: ModuleEntry): string | null {
  const tile = MODULE_TILES[e.key];
  if (!tile?.attention || e.attention === null || e.attention === 0) return null;
  return countPhrase(e.attention, tile.attention);
}
