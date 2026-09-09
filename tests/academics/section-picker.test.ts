import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient } from "../helpers/client";

/**
 * The class picker, which seventeen screens share.
 *
 * `sections` carries `session_id` — rule 2 puts it there so every query can
 * filter on it without a join — and none of the three readers did. Measured on
 * the demo school, `listSections()` returned **24 rows across two academic
 * years**, with *"Grade 1 · A"* appearing twice under an identical label.
 *
 * RLS cannot catch this and is not supposed to: a policy answers *which tenant*
 * and *whose rows*, never *which year*. The year is a label, and a label is
 * enforced only by the reader — so the guard is a test, and it comes in two
 * halves because neither alone is enough.
 */
const SECTION_READERS: [file: string, fn: string][] = [
  ["src/app/(app)/students/actions.ts", "listSections"],
  ["src/app/(app)/attendance/actions.ts", "listAllSections"],
  ["src/app/(app)/attendance/actions.ts", "listMarkableSections"],
];

describe("the class picker knows which year it is", () => {
  // Half one: the source. These are Server Actions — they call `cookies()` from
  // `next/headers`, so importing one into a test would throw outside a request
  // and the assertion would never run. A test that can never go green is a test
  // people learn to ignore, so this reads the query instead of calling it.
  it.each(SECTION_READERS)("%s: %s filters on the session", (file, fn) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    const start = src.indexOf(`export async function ${fn}(`);
    expect(start, `${fn} not found in ${file}`).toBeGreaterThan(-1);

    const next = src.indexOf("\nexport ", start + 1);
    const body = src.slice(start, next === -1 ? undefined : next);

    expect(
      body.includes('.eq("session_id"'),
      `${fn} reads public.sections without filtering on session_id, so it offers ` +
        `last year's classes under this year's names`,
    ).toBe(true);
  });
});

// Half two: the data. The source check would still pass if somebody filtered on
// the wrong session, and the failure a person actually meets is not "too many
// rows" — it is *"which of these two Grade 1 A's is mine"*.
describe("no two classes share a name in one year", () => {
  let a: SupabaseClient<Database>;

  beforeAll(async () => {
    a = await tenantAClient();
  });

  it("holds for the current session", async () => {
    const { data: current } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true)
      .single();

    const { data, error } = await a
      .from("sections")
      .select("name, class_levels ( name )")
      .eq("session_id", current?.id ?? "");

    expect(error).toBeNull();
    const labels = (data ?? []).map((s) => `${s.class_levels?.name ?? "?"} · ${s.name}`);
    const duplicates = labels.filter((l, i) => labels.indexOf(l) !== i);

    expect(labels.length).toBeGreaterThan(0);
    expect(duplicates, "a picker cannot tell two identically named classes apart").toEqual([]);
  });
});
