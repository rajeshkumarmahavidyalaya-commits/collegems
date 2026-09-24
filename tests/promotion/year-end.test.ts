import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { laterYears } from "@/lib/validations/promotion-display";
import { parseYearEnd, yearEndSteps, type YearEnd } from "@/lib/validations/year-end";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Comments out, then match: a comment can hide a violation and fake one. */
function sql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const ALL = FILES.map((f) => sql(readFileSync(join(MIGRATIONS, f), "utf8"))).join("\n");

/** The latest definition: migrations are immutable, so the highest number wins. */
function functionBody(name: string): string {
  let found = "";
  const pattern = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(ALL)) !== null) {
    const rest = ALL.slice(m.index);
    const end = rest.search(/\n\$(?:function)?\$;/);
    found = rest.slice(0, end);
  }
  return found;
}

/** The college's three years as they stand, oldest first as the pickers receive them. */
const YEARS = [
  { id: "y24", name: "2024-2025", startDate: "2024-04-01", isCurrent: false },
  { id: "y25", name: "2025-2026", startDate: "2025-04-01", isCurrent: true },
  { id: "y26", name: "2026-2027", startDate: "2026-04-01", isCurrent: false },
];

describe("a year turns forward", () => {
  it("the receiving year defaults to the one after, never the one before", () => {
    // The pickers used "the first year that is not current", which on this
    // list is 2024-2025: every child promoted into last year.
    const naive = YEARS.find((y) => !y.isCurrent);
    expect(naive?.name).toBe("2024-2025");
    expect(laterYears(YEARS, "y25").map((y) => y.name)).toEqual(["2026-2027"]);
    expect(laterYears(YEARS, "y24").map((y) => y.name)).toEqual(["2025-2026", "2026-2027"]);
    expect(laterYears(YEARS, "y26")).toEqual([]);
    expect(laterYears(YEARS, "missing")).toEqual([]);
  });

  it("both pickers ask laterYears rather than 'not current'", () => {
    for (const file of [
      "src/app/(app)/promotion/promotion-planner.tsx",
      "src/app/(app)/promotion/renewals/renewal-launcher.tsx",
      "src/app/(app)/academics/sessions/page.tsx",
    ]) {
      const src = read(file);
      expect(src, file).toContain("laterYears(");
      expect(src, file).not.toMatch(/!s\.isCurrent\s*&&/);
      expect(src, file).not.toMatch(/\.filter\(\(s\) => s\.id !== (fromId|current\?\.id|form\.fromSessionId)\)/);
    }
  });

  it("every function that writes across a year pair checks the direction first", () => {
    const names = new Set<string>();
    const pattern = /create (?:or replace )?function public\.(\w+)\s*\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(ALL)) !== null) {
      if (/p_from_session_id/.test(m[2]) && /p_to_session_id/.test(m[2])) names.add(m[1]);
    }
    names.delete("academics_require_later_year");
    const writers = [...names].filter((n) => /\b(insert into|update)\s+public\./.test(functionBody(n)));
    // A sweep that found nothing would pass on nothing.
    expect(writers.sort()).toEqual([
      "academics_roll_forward_sections",
      "fees_roll_forward_structures",
      "promotion_start_run",
      "renewal_start_run",
      "transport_roll_forward_routes",
    ]);
    for (const w of writers) {
      const body = functionBody(w);
      const check = body.indexOf("academics_require_later_year(");
      expect(check, `${w} writes across years without checking which way`).toBeGreaterThan(0);
      expect(check, `${w} checks after it has written`).toBeLessThan(body.search(/\binsert into\b/));
    }
  });
});

describe("an unpaid balance is owed once", () => {
  it("applying a run raises no invoice: the debt stays on its own year", () => {
    // Measured before 0276: 26,908.00 owed became 26,908.00 this year plus
    // 26,908.00 as last year's arrears.
    const apply = functionBody("promotion_apply");
    expect(apply.length).toBeGreaterThan(0);
    expect(apply).not.toMatch(/insert into public\.invoices/);
    expect(apply).not.toMatch(/insert into public\.invoice_lines/);
  });

  it("a run records what is owed and bills none of it", () => {
    const start = functionBody("promotion_start_run");
    expect(start).toMatch(/pv\.outstanding,\s*0\s*from public\.promotion_preview/);
  });

  it("the planner no longer offers a choice that billed twice", () => {
    const planner = read("src/app/(app)/promotion/promotion-planner.tsx");
    expect(planner).not.toMatch(/carryForwardFees|carry-fees/);
    expect(read("src/lib/validations/promotion.ts")).not.toMatch(/carry_forward_fees:\s*z\./);
  });
});

describe("a held child can still be promoted later", () => {
  it("only a draft run blocks another between the same two years", () => {
    const last = ALL.lastIndexOf("create unique index promotion_runs_one_live");
    expect(ALL.slice(last, ALL.indexOf(";", last))).toMatch(/where status = 'draft'/);
    const renewal = ALL.lastIndexOf("create unique index renewal_runs_one_live");
    expect(ALL.slice(renewal, ALL.indexOf(";", renewal))).toMatch(/where status = 'draft'/);
  });

  it("a hold row carries no class, so the default rules can start a run", () => {
    const preview = functionBody("promotion_preview");
    expect(preview).toMatch(
      /when t\.intent in \('promote', 'repeat'\) then t\.target_section_id\s+else null\s+end as to_section_id/,
    );
  });
});

describe("switching the year says who would be left behind", () => {
  it("refuses with a named count unless forced, and keeps its grants narrow", () => {
    const activate = functionBody("academics_session_activate");
    expect(activate).toMatch(/p_force boolean default false/);
    expect(activate).toMatch(/if not p_force/);
    expect(activate).toContain("errcode = '55000'");
    // Backwards is asked too (0278): going back is how a mistaken switch is
    // undone, so it is confirmed rather than refused.
    expect(activate).toMatch(/v_target\.start_date < v_current\.start_date/);
    expect(activate.match(/errcode = '55000'/g)).toHaveLength(2);
    expect(ALL).toMatch(
      /revoke all on function public\.academics_session_activate\(uuid, boolean\) from public, anon;/,
    );
  });

  it("the action tells the dialog when it may offer 'switch anyway'", () => {
    const actions = read("src/app/(app)/academics/sessions/actions.ts");
    expect(actions).toContain('needsConfirmation: error.code === "55000"');
  });
});

/** The live document for the demo college on 24 Sep 2026, before anything was done. */
const BEFORE = {
  to: { id: "37ad", name: "2026-2027", isCurrent: false, startDate: "2026-04-01" },
  fees: { to: 0, from: 24 },
  from: { id: "9a71", name: "2025-2026", endDate: "2026-03-31" },
  classes: { to: 12, from: 12 },
  children: { moved: 0, waiting: 302, draftRun: null },
  renewals: { hostel: 0, transport: 0 },
};

describe("the checklist", () => {
  const steps = yearEndSteps(parseYearEnd(BEFORE)!);
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));

  it("is in the order the work has to happen, switch last", () => {
    expect(steps.map((s) => s.key)).toEqual(["classes", "fees", "promote", "renew", "switch"]);
  });

  it("reads the demo college's day as it is", () => {
    expect(byKey.classes.state).toBe("done");
    expect(byKey.fees.state).toBe("todo");
    expect(byKey.fees.detail).toContain("Copy 2025-2026's 24 fees across");
    expect(byKey.promote.detail).toContain("302 children in 2025-2026 have not been moved into 2026-2027");
    // Nothing to count before anybody moves: "later", not a green tick.
    expect(byKey.renew.state).toBe("later");
    expect(byKey.switch.detail).toContain("Do this last");
  });

  it("agrees in number across the whole sentence", () => {
    const one: YearEnd = {
      ...parseYearEnd(BEFORE)!,
      children: { waiting: 1, moved: 251, draftRun: null },
      renewals: { transport: 1, hostel: 0 },
    };
    const s = Object.fromEntries(yearEndSteps(one).map((x) => [x.key, x]));
    expect(s.promote.detail).toContain("1 child in 2025-2026 has not been moved");
    expect(s.promote.detail).toContain("251 children are already enrolled");
    expect(s.renew.detail).toBe("1 bus seat of promoted children has not been carried into 2026-2027.");
    expect(s.switch.detail).toContain("the 1 child not yet promoted");
  });

  it("does not throw on a missing key, and has nothing to say without a next year", () => {
    expect(parseYearEnd({})).toBeNull();
    expect(parseYearEnd(null)).toBeNull();
    const partial = parseYearEnd({ to: { id: "x", name: "2027-2028" } })!;
    expect(partial.children.waiting).toBe(0);
    expect(yearEndSteps(partial)).toHaveLength(5);
  });
});
