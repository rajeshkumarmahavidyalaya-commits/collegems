import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULE_CARDS, MODULE_TILES, parseModuleCards } from "@/lib/validations/modules";

/**
 * One shape on every module page (0294, 0295): a strip of counts, then the
 * list. And staff riding the same buses as the children (0293).
 *
 * `module_cards()` decides which cards exist; `MODULE_CARDS` only draws them.
 * Two lists that must agree are safe to keep only while something checks them
 * against each other -- 0290's rule, one screen further in.
 */
const ROOT = process.cwd();
const DIR = join(ROOT, "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const strip = (s: string) => s.replace(/--.*$/gm, "");
const SQL = FILES.map((f) => ({ f, sql: strip(readFileSync(join(DIR, f), "utf8")) }));
const ALL = SQL.map((s) => s.sql).join("\n");

function latest(name: string): { file: string; header: string; body: string } {
  for (const { f, sql } of [...SQL].reverse()) {
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    const m = [...sql.matchAll(re)].pop();
    if (!m) continue;
    const start = sql.indexOf("$$", m.index!);
    const end = sql.indexOf("$$", start + 2);
    return { file: f, header: sql.slice(m.index!, start), body: sql.slice(start + 2, end) };
  }
  throw new Error(`${name} is defined nowhere`);
}

const src = (p: string) =>
  readFileSync(join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function routeExists(href: string): boolean {
  const path = href.split("?")[0].replace(/^\//, "");
  return existsSync(join(ROOT, "src/app/(app)", path, "page.tsx"));
}

/** Each module's branch of the function body, keyed by the module. */
function branches(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(?:els)?if p_module = '([a-z_]+)' then/g;
  const hits = [...body.matchAll(re)];
  hits.forEach((m, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index! : body.indexOf("\n  else\n", m.index!);
    out.set(m[1], body.slice(m.index!, end));
  });
  return out;
}

/** The cards drawn only inside `if current_role_allows('x') then ... end if;` after the gate. */
function guardedKeys(branch: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\n\s+if public\.current_role_allows\('([a-z_.]+)'\) then([\s\S]*?)end if;/g;
  for (const m of branch.matchAll(re)) {
    for (const k of m[2].matchAll(/'key', '([a-z_]+)'/g)) out.set(k[1], m[1]);
  }
  return out;
}

/** Module -> the page that draws its strip. */
const PAGES: Record<string, string> = {
  students: "students",
  staff: "staff",
  classes: "academics",
  attendance: "attendance",
  fees: "fees",
  exams: "exams",
  library: "library/issues",
  transport: "transport",
  hostel: "hostel",
  inventory: "inventory",
  front_office: "front-office",
  notices: "notices",
  accounts: "accounts",
  certificates: "certificates",
  payroll: "payroll",
  staff_attendance: "hr",
};

/** Cards whose honest count needs every row, and the permission that acts on them (0295). */
const ROW_OWNED: Record<string, Record<string, string>> = {
  students: { without_class: "students.manage" },
  library: { members: "library.issue", out: "library.issue", overdue: "library.issue" },
  transport: { students: "transport.assign", staff: "transport.assign" },
  hostel: { occupied: "hostel.allocate" },
  notices: { drafts: "notices.manage" },
};

describe("module_cards", () => {
  const { file, header, body } = latest("module_cards");
  const b = branches(body);

  it("is the 0295 definition, an invoker that never filters by tenant itself", () => {
    expect(file).toMatch(/^0295_/);
    expect(header).not.toMatch(/security definer/);
    expect(body).not.toMatch(/tenant_id\s*=/);
    expect(ALL).toMatch(/revoke all on function public\.module_cards\(text\) from public, anon;/);
  });

  it("gates each module on the same permission as its home tile", () => {
    for (const [mod, branch] of b) {
      const gate = branch.match(/if not public\.current_role_allows\('([a-z_.]+)'\) then return null;/)?.[1];
      expect(gate, mod).toBe(MODULE_TILES[mod]?.gate);
    }
  });

  it("returns exactly the cards the page knows how to draw", () => {
    expect(new Set(b.keys())).toEqual(new Set(Object.keys(MODULE_CARDS)));
    for (const [mod, branch] of b) {
      const keys = [...branch.matchAll(/'key', '([a-z_]+)'/g)].map((m) => m[1]);
      expect(new Set(keys), mod).toEqual(new Set(Object.keys(MODULE_CARDS[mod])));
    }
  });

  it("draws a row-owned count only for the permission that acts on it (0295)", () => {
    for (const [mod, cards] of Object.entries(ROW_OWNED)) {
      const guarded = guardedKeys(b.get(mod)!);
      for (const [key, perm] of Object.entries(cards)) {
        expect(guarded.get(key), `${mod}.${key}`).toBe(perm);
      }
    }
  });

  it("the row-owned check catches a card moved out of its branch (synthetic plant)", () => {
    const planted = `if p_module = 'library' then
    if not public.current_role_allows('library.view') then return null; end if;
    v_cards := jsonb_build_array(jsonb_build_object('key', 'titles'),
      jsonb_build_object('key', 'overdue'));
  `;
    expect(guardedKeys(planted).get("overdue")).toBeUndefined();
  });

  it("staff attendance cards are drawn for hr.manage only", () => {
    expect(b.get("staff_attendance")).toMatch(
      /if not public\.current_role_allows\('hr\.manage'\) then\s+return jsonb_build_object\('module', p_module, 'cards', '\[\]'::jsonb\);/,
    );
  });
});

describe("the strip", () => {
  it("every card's link goes to a page that exists, and not the one it sits on", () => {
    for (const [mod, cards] of Object.entries(MODULE_CARDS)) {
      for (const [key, card] of Object.entries(cards)) {
        if (!card.href) continue;
        expect(routeExists(card.href), `${mod}.${key} -> ${card.href}`).toBe(true);
        if (PAGES[mod]) expect(card.href.split("?")[0], `${mod}.${key}`).not.toBe(`/${PAGES[mod]}`);
      }
    }
  });

  it("is on every module page, naming its own module", () => {
    for (const [mod, page] of Object.entries(PAGES)) {
      expect(src(`src/app/(app)/${page}/page.tsx`), page).toMatch(
        new RegExp(`<ModuleCards module="${mod}" />`),
      );
    }
  });

  it("decides nothing about roles: the function does", () => {
    const c = src("src/components/module-cards.tsx");
    expect(c).not.toMatch(/roleCode|roleTier|hasPermission|"use client"/);
    expect(c).toMatch(/supabase\.rpc\("module_cards", \{ p_module: module \}\)/);
  });

  it("parses defensively and drops a key it cannot draw", () => {
    const parsed = parseModuleCards("transport", {
      cards: [{ key: "vehicles", count: 2 }, { key: "mystery", count: 9 }, { key: "routes" }, null],
    });
    expect(parsed).toEqual([{ key: "vehicles", count: 2 }]);
    expect(parseModuleCards("transport", null)).toEqual([]);
    expect(parseModuleCards("nowhere", { cards: [{ key: "vehicles", count: 1 }] })).toEqual([]);
  });
});

describe("staff ride the same buses (0293)", () => {
  const m = SQL.find((s) => s.f.startsWith("0293_"))!.sql;

  it("a seat has exactly one rider, and a staff seat is free", () => {
    expect(m).toMatch(/check \(num_nonnulls\(student_id, staff_id\) = 1\)/);
    expect(m).toMatch(/check \(staff_id is null or monthly_fare = 0\)/);
  });

  it("a member of staff holds one seat at a time: null = null is never true, so the twin exclusion", () => {
    expect(m).toMatch(
      /transport_assignments_staff_no_overlap\s+exclude using gist \([\s\S]*?staff_id with =[\s\S]*?where \(status = 'active' and staff_id is not null\)/,
    );
  });

  it("a staff seat is counted under the same lock as a child's", () => {
    const staff = latest("transport_assign_staff_for").body;
    const child = latest("transport_assign_student_for").body;
    const lock = /pg_advisory_xact_lock\(hashtextextended\(v_stop\.route_id::text, 0\)\)/;
    expect(staff).toMatch(lock);
    expect(child).toMatch(lock);
    expect(latest("transport_assign_staff_for").header).not.toMatch(/security definer/);
  });

  it("readers that mean children only now say so", () => {
    expect(latest("renewal_preview").body).toMatch(/ta\.student_id is not null/);
    expect(latest("academics_session_problems").body).toMatch(/ta\.student_id is not null/);
  });

  it("leaving ends the seat, and a delete counts it", () => {
    expect(latest("staff_exit").body).toMatch(/'transport', v_seats/);
    expect(latest("guard_staff_delete").body).toMatch(/'bus seat', 'bus seats'/);
  });

  it("the office can give a seat, and the record shows it", () => {
    const actions = src("src/app/(app)/transport/actions.ts");
    expect(actions).toMatch(/rpc\("transport_assign_staff"/);
    expect(actions).toMatch(/rpc\("transport_for_staff"/);
    expect(src("src/app/(app)/transport/assignments/assignments-view.tsx")).toMatch(/<StaffSeatForm/);
    expect(src("src/app/(app)/staff/[id]/page.tsx")).toMatch(/currentStaffSeat\(staff\.id\)/);
  });
});
