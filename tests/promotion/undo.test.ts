import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseUndo, undoSentence } from "@/lib/validations/promotion-display";

/**
 * Undoing an applied promotion run (migrations 0279-0280). Read from the
 * migrations, so it runs where the database suites skip. Each assertion was
 * verified by planting the violation it names.
 */

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** Comments out, then match: a comment can hide a violation and fake one. */
function sql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const ALL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => sql(readFileSync(join(MIGRATIONS, f), "utf8")))
  .join("\n");

/** The latest definition: migrations are immutable, so the highest number wins. */
function functionBody(name: string): string {
  let found = "";
  const pattern = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(ALL)) !== null) {
    const rest = ALL.slice(m.index);
    found = rest.slice(0, rest.search(/\n\$(?:function)?\$;/));
  }
  return found;
}

/** Every table that ties a student to a year, as the migrations declare it. */
function tablesWithStudentAndYear(): string[] {
  const cols = new Map<string, Set<string>>();
  const add = (table: string, names: string[]) => {
    const set = cols.get(table) ?? new Set<string>();
    names.forEach((n) => set.add(n));
    cols.set(table, set);
  };
  for (const m of ALL.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    add(m[1], [...m[2].matchAll(/^\s*(\w+)\s/gm)].map((c) => c[1]));
  }
  for (const m of ALL.matchAll(/alter table (?:only )?public\.(\w+)\s+((?:add column[^;]*?)+);/g)) {
    add(m[1], [...m[2].matchAll(/add column (?:if not exists )?(\w+)/g)].map((c) => c[1]));
  }
  const dropped = new Set([...ALL.matchAll(/drop table (?:if exists )?public\.(\w+)/g)].map((m) => m[1]));
  return [...cols]
    .filter(([t, c]) => c.has("student_id") && c.has("session_id") && !dropped.has(t))
    .map(([t]) => t)
    .sort();
}

const undo = functionBody("promotion_undo");
const apply = functionBody("promotion_apply");

describe("undo removes only what the run made", () => {
  it("apply records whether it created the enrolment or adopted one", () => {
    expect(apply).toMatch(/v_created := v_enrolment_id is not null;/);
    expect(apply).toMatch(/created_enrolment = v_created/);
    // The flag is set from the insert's own RETURNING, before the fallback
    // lookup overwrites v_enrolment_id with somebody else's enrolment.
    expect(apply.indexOf("v_created := v_enrolment_id is not null")).toBeLessThan(
      apply.indexOf("if v_enrolment_id is null then"),
    );
  });

  it("the enrolments it deletes are the ones flagged as created", () => {
    expect(undo).toMatch(
      /array_agg\(d\.applied_enrolment_id\) filter \(where d\.created_enrolment and d\.applied_enrolment_id is not null\)/,
    );
    const deletes = [...undo.matchAll(/delete from public\.(\w+)/g)].map((m) => m[1]);
    expect(deletes).toEqual(["enrolments"]);
    expect(undo).toMatch(/delete from public\.enrolments e\s+where e\.tenant_id = v_tenant_id and e\.id = any\(v_created\);/);
  });

  it("asserts the row count after every write that must touch a known number", () => {
    for (const [write, count] of [
      [/delete from public\.enrolments/, /if v_removed <> cardinality\(v_created\)/],
      [/set status = 'active'\s+where e\.tenant_id/, /if v_restored <> v_expected/],
      [/update public\.students s/, /if v_students <> cardinality\(v_grads\)/],
      [/update public\.promotion_runs r/, /if v_n <> 1 then/],
    ] as const) {
      const at = undo.search(write);
      expect(at, String(write)).toBeGreaterThan(0);
      expect(undo.slice(at).search(count), String(count)).toBeGreaterThan(0);
    }
  });

  it("puts the run back to draft and keeps that it was undone", () => {
    expect(undo).toMatch(/set status = 'draft', applied_at = null, applied_by = null,/);
    expect(undo).toMatch(/undone_at = now\(\), undone_by = auth\.uid\(\)/);
  });
});

describe("undo refuses before it writes", () => {
  const firstWrite = undo.search(/\b(delete from|update) public\./);

  it("checks every refusal before the first write", () => {
    expect(firstWrite).toBeGreaterThan(0);
    for (const refusal of [
      "Only an administrator can undo",
      "so there is nothing to undo",
      "There is already a draft run",
      "This run cannot be undone: in %",
      "This run cannot be undone, because what it wrote has changed since",
    ]) {
      const at = undo.indexOf(refusal);
      expect(at, refusal).toBeGreaterThan(0);
      expect(at, `${refusal} comes after a write`).toBeLessThan(firstWrite);
    }
  });

  it("counts registers by enrolment, which is what cascades", () => {
    expect(undo).toMatch(/from public\.attendance_records a\s+where a\.tenant_id = v_tenant_id and a\.enrolment_id = any\(v_created\)/);
    expect(undo).toMatch(/from public\.promotion_decisions d\s+where d\.tenant_id = v_tenant_id and d\.from_enrolment_id = any\(v_created\)/);
  });

  it("asks every table that ties a student to a year", () => {
    const tables = tablesWithStudentAndYear();
    // A sweep that found nothing would pass on nothing.
    expect(tables.length).toBeGreaterThanOrEqual(15);
    // The enrolment is the thing being removed, not something hanging off it.
    const asked = new Set([...undo.matchAll(/\('(\w+)', '(?:created_at|started_at)'/g)].map((m) => m[1]));
    const missing = tables.filter((t) => t !== "enrolments" && !asked.has(t));
    expect(missing, "a new table ties a student to a year; add it to promotion_undo's list").toEqual([]);
  });

  it("counts only rows made since the run was applied (0280)", () => {
    // A bed booked for next year before anybody was promoted was never written
    // against the run's enrolments. Counting it refused the demo college's run.
    expect(undo).toMatch(/and x\.%I >= \$4%s'/);
    expect(undo).toMatch(/using v_tenant_id, v_run\.to_session_id, v_movers, v_run\.applied_at;/);
  });
});

describe("graduates come back only where nothing changed since", () => {
  it("restores what the apply's own transaction ended, by its timestamp", () => {
    for (const table of ["student_concessions", "members", "transport_assignments", "hostel_allocations"]) {
      const at = undo.indexOf(`update public.${table}`);
      expect(at, table).toBeGreaterThan(0);
      const statement = undo.slice(at, undo.indexOf(";", at));
      expect(statement, table).toMatch(/updated_at = v_run\.applied_at/);
    }
  });

  it("names what it could not put back rather than guessing", () => {
    expect(undo).toMatch(/been left ended/);
    expect(undo).toMatch(/'notRestored', to_jsonb\(v_not_restored\)/);
  });

  it("stays INVOKER with a narrow grant", () => {
    const head = undo.slice(0, undo.indexOf("as $function$"));
    expect(head).not.toMatch(/security definer/i);
    expect(ALL).toMatch(/revoke all on function public\.promotion_undo\(uuid\) from public, anon;/);
  });
});

describe("what the screen says", () => {
  it("agrees in number and names only what happened", () => {
    const one = parseUndo({ removed: 1, reopened: 1, graduates: 0, notRestored: [] });
    expect(undoSentence(one, "2025-2026", "2026-2027")).toBe(
      "Removed 1 enrolment from 2026-2027 and reopened 1 in 2025-2026. The run is a draft again.",
    );
    const demo = parseUndo({ removed: 252, reopened: 302, graduates: 50, library: 10, concessions: 0 });
    expect(undoSentence(demo, "2025-2026", "2026-2027")).toBe(
      "Removed 252 enrolments from 2026-2027 and reopened 302 in 2025-2026. 50 graduates are back on the roll, with 10 library cards restored. The run is a draft again.",
    );
    const single = parseUndo({ removed: 0, reopened: 1, graduates: 1, beds: 1 });
    expect(undoSentence(single, "a", "b")).toContain("1 graduate is back on the roll, with 1 hostel bed restored.");
  });

  it("does not throw on a missing or malformed document", () => {
    expect(parseUndo(null)).toEqual({
      removed: 0, reopened: 0, graduates: 0, library: 0, concessions: 0, seats: 0, beds: 0, notRestored: [],
    });
    expect(parseUndo({ notRestored: ["a", 3, null] }).notRestored).toEqual(["a"]);
  });

  it("the review screen offers the undo and no longer says it cannot be done", () => {
    const review = readFileSync(join(ROOT, "src/app/(app)/promotion/[runId]/run-review.tsx"), "utf8");
    expect(review).toContain("undoRun(run.id)");
    expect(review).not.toMatch(/cannot be undone from this screen/);
    expect(review).not.toMatch(/not\s+something this screen can take back/);
  });
});
