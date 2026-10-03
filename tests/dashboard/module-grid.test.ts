import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODULE_ORDER,
  MODULE_TILES,
  attentionLine,
  countPhrase,
  parseModuleOverview,
  tileLine,
} from "@/lib/validations/modules";

/**
 * Every module on one screen (0290-0292).
 *
 * The home page's grid draws a tile only for a module `module_overview()`
 * returns, and the function gates each on a permission. `MODULE_TILES` carries
 * a copy of that gate so it can be compared here: two lists that must agree are
 * safe to keep only while something checks them against each other.
 */
const ROOT = process.cwd();
const DIR = join(ROOT, "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const strip = (s: string) => s.replace(/--.*$/gm, "");
const SQL = FILES.map((f) => ({ f, sql: strip(readFileSync(join(DIR, f), "utf8")) }));
const ALL = SQL.map((s) => s.sql).join("\n");

function latest(name: string): { header: string; body: string } {
  for (const { sql } of [...SQL].reverse()) {
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    const m = [...sql.matchAll(re)].pop();
    if (!m) continue;
    const start = sql.indexOf("$$", m.index!);
    const end = sql.indexOf("$$", start + 2);
    return { header: sql.slice(m.index!, start), body: sql.slice(start + 2, end) };
  }
  throw new Error(`${name} is defined nowhere`);
}

const src = (p: string) =>
  readFileSync(join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** `/academics?tab=classes` -> does `src/app/(app)/academics/page.tsx` exist? */
function routeExists(href: string): boolean {
  const path = href.split("?")[0].replace(/^\//, "");
  return existsSync(join(ROOT, "src/app/(app)", path, "page.tsx"));
}

describe("module_overview", () => {
  const { header, body } = latest("module_overview");

  it("is an invoker, so a tile counts what its own screen shows", () => {
    expect(header).not.toMatch(/security definer/);
    expect(ALL).toMatch(/revoke all on function public\.module_overview\(\) from public, anon;/);
  });

  it("never filters by tenant itself: RLS decides, as in every invoker read model", () => {
    expect(body).not.toMatch(/tenant_id\s*=/);
  });

  it("gates every tile on the permission MODULE_TILES says, and draws no key it cannot place", () => {
    const keys = [...body.matchAll(/'key', '([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(keys)).toEqual(new Set(Object.keys(MODULE_TILES)));
    for (const key of keys) {
      const at = body.indexOf(`'key', '${key}'`);
      const gates = [...body.slice(0, at).matchAll(/if public\.current_role_allows\('([a-z_.]+)'\) then/g)];
      const gate = gates.pop()?.[1];
      expect(gate, key).toBe(MODULE_TILES[key].gate);
    }
  });

  it("leaves to the brief the two numbers the dashboard already computes (0291)", () => {
    expect(body).not.toMatch(/fees_day_book/);
    expect(body).not.toMatch(/hr_attendance_sheet/);
  });
});

describe("the tiles", () => {
  it("every tile and every action goes to a page that exists", () => {
    for (const [key, tile] of Object.entries(MODULE_TILES)) {
      expect(routeExists(tile.href), `${key} -> ${tile.href}`).toBe(true);
      if (tile.action) expect(routeExists(tile.action.href), `${key} -> ${tile.action.href}`).toBe(true);
    }
  });

  it("every tile has a place in the order", () => {
    expect(new Set(MODULE_ORDER)).toEqual(new Set(Object.keys(MODULE_TILES)));
  });

  it("parses defensively and drops a key it cannot draw", () => {
    const parsed = parseModuleOverview({
      modules: [
        { key: "library", count: 18, attention: 3, can_act: true },
        { key: "students", count: 302, attention: null, can_act: false },
        { key: "something_new", count: 1 },
        "nonsense",
      ],
    });
    expect(parsed.map((e) => e.key)).toEqual(["students", "library"]);
    expect(parseModuleOverview(null)).toEqual([]);
  });

  it("agrees in number with the whole phrase", () => {
    expect(countPhrase(1, MODULE_TILES.students.noun)).toBe("1 student on roll");
    expect(countPhrase(302, MODULE_TILES.students.noun)).toBe("302 students on roll");
    expect(countPhrase(0, MODULE_TILES.library.noun)).toBe("0 books out");
    expect(countPhrase(null, MODULE_TILES.library.noun)).toBeNull();
  });

  it("says a register count out of its roll, and says nothing when it has no number", () => {
    const base = { attention: null, canAct: true, lastMonth: null };
    expect(tileLine({ ...base, key: "attendance", count: 3, total: 12 })).toBe("3 of 12 classes marked today");
    expect(tileLine({ ...base, key: "staff_attendance", count: null, total: null })).toBeNull();
    expect(tileLine({ ...base, key: "payroll", count: null, total: null })).toBe("Not run yet");
  });

  it("draws the amber line only when there is something to do", () => {
    const base = { count: 18, total: null, canAct: true, lastMonth: null };
    expect(attentionLine({ ...base, key: "library", attention: 0 })).toBeNull();
    expect(attentionLine({ ...base, key: "library", attention: 2 })).toBe("2 overdue");
    expect(attentionLine({ ...base, key: "students", attention: 5 })).toBeNull();
  });
});

describe("the home page", () => {
  // The page streams its sections (lazy loading); the grid and its feed live
  // in dashboard-sections.tsx, which the page renders.
  const page = src("src/components/dashboard/dashboard-sections.tsx");

  it("gives staff the grid and a family their own links", () => {
    expect(src("src/app/(app)/page.tsx")).toMatch(/<DashboardModules /);
    expect(page).toMatch(/roleTier === "student" \? \(/);
    expect(page).toMatch(/<ModuleGrid/);
  });

  it("feeds the grid the brief's receipts and staff register rather than asking twice", () => {
    expect(page).toMatch(/receipts_today/);
    expect(page).toMatch(/staff_attendance\?\.marked/);
    // ...from the same memoised summary every section reads, not a second call.
    expect(page.match(/rpc\("dashboard_summary"\)/g)).toHaveLength(1);
    expect(page).toMatch(/const getBrief = cache\(/);
  });

  it("the grid decides nothing about roles", () => {
    const grid = src("src/components/dashboard/module-grid.tsx");
    expect(grid).not.toMatch(/roleCode|roleTier|hasPermission/);
    expect(grid).toMatch(/supabase\.rpc\("module_overview"\)/);
  });
});

describe("the daily jobs", () => {
  it("a borrower is found by name, not from the first twenty cards", () => {
    const { header, body } = latest("library_member_search");
    expect(header).not.toMatch(/security definer/);
    expect(body).toMatch(/length\(btrim\(coalesce\(p_query, ''\)\)\) >= 2/);
    expect(body).toMatch(/order by full_name, m\.id/);
    const actions = src("src/app/(app)/library/actions.ts");
    expect(actions).not.toMatch(/listIssuableMembers/);
    expect(actions).toMatch(/rpc\("library_member_search"/);
  });

  it("the library counter can issue a book, gated on the permission the write needs", () => {
    const page = src("src/app/(app)/library/issues/page.tsx");
    expect(page).toMatch(/hasPermission\("library\.issue"\)/);
    expect(page).toMatch(/\{canIssue && <IssueBookDialog/);
  });

  it("the fee counter takes a student only as a uuid, and the record links to it", () => {
    const counter = src("src/app/(app)/fees/counter/page.tsx");
    expect(counter).toMatch(/uuid\.test\(student\)/);
    expect(src("src/app/(app)/students/[id]/page.tsx")).toMatch(/\/fees\/counter\?student=\$\{student\.id\}/);
  });

  it("the register opens on a class nobody has marked yet", () => {
    const page = src("src/app/(app)/attendance/page.tsx");
    expect(page).toMatch(/sections\.find\(\(s\) => !markedSet\.has\(s\.id\)\)/);
  });

  it("admitting and adding staff can carry on to the next one", () => {
    expect(src("src/app/(app)/students/student-form.tsx")).toMatch(/Admit and add another/);
    expect(src("src/app/(app)/staff/staff-form.tsx")).toMatch(/Add and add another/);
  });
});
