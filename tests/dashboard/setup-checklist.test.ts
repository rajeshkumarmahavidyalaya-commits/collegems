import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETUP_STEPS, parseSetupProgress, setupSentence } from "@/lib/validations/setup";

/**
 * `setup_progress()` (0284) is a definer, so it is rule 4's other shape and
 * must hold to its terms: tenant filtered by hand in every step, each step
 * gated on a permission, booleans out, and no anonymous caller.
 */
const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/0284_what_is_left_before_a_college_is_ready.sql"),
  "utf8",
).replace(/--.*$/gm, "");
const body = SQL.split("$function$")[1];

describe("setup_progress keeps to the definer's terms", () => {
  it("filters every table it reads by the caller's tenant", () => {
    const reads = [...body.matchAll(/from public\.(\w+) (\w+)\s+where ([^)]*)/g)];
    expect(reads.length).toBeGreaterThanOrEqual(8);
    for (const [, table, alias, where] of reads) {
      expect(where, table).toContain(`${alias}.tenant_id = v_tenant`);
    }
  });

  it("gates each step on a permission and returns only booleans", () => {
    const steps = [...body.matchAll(/'key', '(\w+)', 'done',/g)].map((m) => m[1]);
    expect(steps.sort()).toEqual(Object.keys(SETUP_STEPS).sort());
    expect(body.match(/role_has_permission\('/g)?.length).toBe(5);
    expect(body).not.toMatch(/jsonb_agg|array_agg|'id'/);
  });

  it("is closed to anonymous callers", () => {
    expect(SQL).toMatch(/security definer/);
    expect(SQL).toMatch(/revoke all on function public\.setup_progress\(\) from public, anon;/);
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
  });
});
