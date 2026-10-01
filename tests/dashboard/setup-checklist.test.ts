import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETUP_STEPS, parseSetupProgress, setupSentence, stepCount } from "@/lib/validations/setup";

/**
 * `setup_progress()` (0284) is a definer, so it is rule 4's other shape and
 * must hold to its terms: tenant filtered by hand in every step, each step
 * gated on a permission, booleans out, and no anonymous caller.
 */
// The latest definition, not 0284's: migrations are immutable and `create or
// replace` is how they change, so a test pinned to the first file stops
// checking the function the day it is redefined (0302 did).
const DIR = join(process.cwd(), "supabase/migrations");
const LATEST = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => /create or replace function public\.setup_progress\(\)/.test(readFileSync(join(DIR, f), "utf8")))
  .pop()!;
const SQL = readFileSync(join(DIR, LATEST), "utf8").replace(/--.*$/gm, "");
const body = SQL.split("$function$")[1];

describe("setup_progress keeps to the definer's terms", () => {
  it("filters every table it reads by the caller's tenant", () => {
    // The clause runs to the first unbalanced ")" or ";". It used to stop at
    // the first ")" of any kind, so 0302's `where up.id = auth.uid() and
    // up.tenant_id = v_tenant` was cut at `auth.uid(` and reported a correct
    // filter as missing: the instrument, not the function.
    const reads = [...body.matchAll(/from public\.(\w+) (\w+)\s+where ((?:[^();]|\([^()]*\))*)/g)];
    expect(reads.length).toBeGreaterThanOrEqual(8);
    for (const [, table, alias, where] of reads) {
      // `tenants` is the tenant (rule 1): its key is `id`, not `tenant_id`.
      if (table === "tenants") {
        expect(where, table).toContain(`${alias}.id = v_tenant`);
        continue;
      }
      expect(where, table).toContain(`${alias}.tenant_id = v_tenant`);
    }
  });

  it("gates each step on a permission and returns only booleans", () => {
    const steps = [...body.matchAll(/'key', '(\w+)',\s*'done',/g)].map((m) => m[1]);
    expect(steps.sort()).toEqual(Object.keys(SETUP_STEPS).sort());
    // One gate per group of steps: settings (profile), academics (year,
    // classes, subjects), fees, staff, students, academics again (timetable),
    // settings again (messages), users.
    expect(body.match(/role_has_permission\('/g)?.length).toBe(8);
    expect(body).not.toMatch(/jsonb_agg|array_agg|'id'/);
  });

  it("is closed to anonymous callers", () => {
    expect(SQL).toMatch(/security definer/);
    // The revoke lives in 0284; `create or replace` keeps it.
    const first = readFileSync(join(DIR, "0284_what_is_left_before_a_college_is_ready.sql"), "utf8");
    expect(first).toMatch(/revoke all on function public\.setup_progress\(\) from public, anon;/);
  });
});

describe("the checklist's words", () => {
  it("drops keys it does not know and agrees in number", () => {
    expect(parseSetupProgress({ steps: [{ key: "fees", done: true }, { key: "rocket", done: false }] })).toEqual([
      { key: "fees", done: true },
    ]);
    expect(parseSetupProgress(null)).toEqual([]);
    expect(setupSentence([{ key: "fees", done: true }, { key: "classes", done: false }])).toBe("1 of 2 done · 1 step left");
    expect(setupSentence([{ key: "fees", done: false }, { key: "classes", done: false }])).toBe("0 of 2 done · 2 steps left");
    // 0310: a step measured over people carries its counts, and only that one.
    const [families] = parseSetupProgress({ steps: [{ key: "family_logins", done: false, have: 1, of: 302 }] });
    expect(stepCount(families)).toBe("1 of 302 reached");
    expect(stepCount({ key: "fees", done: true })).toBeNull();
  });
});
