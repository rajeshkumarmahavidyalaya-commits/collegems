import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A function that demands a reason and does not keep it.
 *
 * `student_exit` refuses to run without one, in these words:
 *
 *   > *Say why this child is leaving — it is the only thing a record five years
 *   > from now will have.*
 *
 * It then validates the length and **discards it**. `p_reason` appears twice in
 * the whole body: once in the signature, once in the `if length(...) < 3`. The
 * note it hands to `student_end_relationships` is not the reason somebody typed
 * — it is `format('Left the school on %s', v_on)`, generated from the date.
 *
 * So the record five years from now has neither half. `students` carries no
 * leaving date and no reason column, and the words never reach `audit_log`
 * either, because the log copies **rows** and this was never on one.
 *
 * Measured across the 295 functions in `public`: **28 take a reason, 25 write
 * it, three do not.** Two shapes, and the difference decides how bad each is:
 *
 * | | function | the screen |
 * |---|---|---|
 * | asked and discarded | `student_exit`, `staff_exit` | a *Why* box, required, ≥3 characters |
 * | never asked | `library_waive_staff_fine` | the app does not pass `p_note` at all |
 *
 * The first is the expensive one: a person is made to type a sentence and it
 * goes nowhere. The second loses nothing today — it is a parameter the product
 * cannot reach, which is rule 15's *"a correct string nobody renders"* wearing
 * a signature.
 *
 * This guard is green on all three, because each is named below with its fix.
 * It fails on a **fourth**, which is the thing worth preventing: the pattern is
 * easy to repeat and impossible to see from the calling screen, where the box
 * is filled in and the save succeeds.
 */

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

/** Parameter names this codebase uses for "a person's own words". */
const REASON_PARAMS = /\bp_(reason|note|remark|comment)\b/g;

function withoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

/**
 * The **latest** definition of each function, which is the only one that runs.
 *
 * This is not a detail. `student_exit` is defined three times — `0174`, `0179`
 * and `0180` — and a guard that scanned every definition would report whichever
 * it met last in filename order by accident, or report the same function three
 * times with three different answers. Migrations are immutable and
 * `create or replace` is how they change, so "what does this function do" is
 * always a question about the highest-numbered file that defines it.
 */
function latestDefinitions(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = withoutComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    const re = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi;
    for (let m = re.exec(sql); m; m = re.exec(sql)) {
      const end = sql.indexOf("$$;", m.index);
      out.set(m[1], { file, body: sql.slice(m.index, end === -1 ? undefined : end) });
    }
  }
  return out;
}

function signatureOf(body: string): string {
  const open = body.indexOf("(");
  let depth = 0;
  for (let i = open; i < body.length; i += 1) {
    if (body[i] === "(") depth += 1;
    else if (body[i] === ")") {
      depth -= 1;
      if (depth === 0) return body.slice(open, i + 1);
    }
  }
  return body.slice(open);
}

/**
 * Does the body do anything with the parameter beyond declaring and checking it?
 *
 * Deliberately generous: any mention outside the signature that is not part of a
 * `raise` or a `length(...)` guard counts as keeping it. A generous test that
 * flags three is a finding; a strict one that flags fifteen is a list nobody
 * reads. It is also the direction that fails safe — a false *negative* here
 * leaves a real defect unnamed, so the three below were each confirmed by
 * reading the whole body rather than by trusting this.
 */
function keepsIt(body: string, param: string): boolean {
  const sig = signatureOf(body);
  const rest = body.slice(body.indexOf(sig) + sig.length);
  return rest
    .split("\n")
    .filter((line) => !/\braise\b/.test(line) && !/\blength\s*\(/.test(line))
    .some((line) => new RegExp(`\\b${param}\\b`).test(line));
}

/**
 * The three, each with what it costs and what would fix it.
 *
 * The bar for adding a fourth is **not** "we have not got round to it". It is
 * that the words genuinely have nowhere to go and nobody is being asked for
 * them — and if somebody is being asked, the screen should stop asking before
 * this list grows.
 */
const DISCARDED: Record<string, string> = {
  student_exit:
    "Asked and discarded. The screen at /students/[id] has a required *Why* box " +
    "(≥3 characters) and the words are validated and dropped; the note passed on " +
    "to student_end_relationships is a generated sentence about the date, not the " +
    "reason. Fix: `students` needs `left_on date` and `exit_reason text`, written " +
    "here — the same two columns `staff` already has one of.",
  staff_exit:
    "Asked and discarded, identically. /staff/[id] has the same required *Why* " +
    "box. `staff.date_of_leaving` exists and is written; the reason has no column. " +
    "Fix: `staff.exit_reason text`, written here.",
  library_waive_staff_fine:
    "Never asked. `p_note` is declared in the signature and not mentioned again, " +
    "and the app calls the function without it — so nothing is lost today. It is " +
    "a parameter the product cannot reach. Fix either way: a " +
    "`staff_fine_waive_note text` column beside `staff_fine_waived_at` and " +
    "`staff_fine_waived_by`, which are written, and a box on the librarian's " +
    "screen — or drop the parameter, because writing off money with no note is a " +
    "decision somebody will be asked about.",
};

describe("a function that asks for a reason keeps it", () => {
  it("finds the functions at all", () => {
    // The sanity check first: a rename that empties this makes every assertion
    // below pass on nothing.
    const defs = latestDefinitions();
    expect(defs.size).toBeGreaterThan(250);
    expect(defs.has("student_exit")).toBe(true);
    expect(defs.has("mobile_revoke_device")).toBe(true);
  });

  it("keeps the words, or is named here with what it would take to", () => {
    const offenders: string[] = [];

    for (const [name, { body }] of latestDefinitions()) {
      const sig = signatureOf(body);
      for (const param of new Set(Array.from(sig.matchAll(REASON_PARAMS), (m) => m[0]))) {
        if (keepsIt(body, param)) continue;
        if (name in DISCARDED) continue;
        offenders.push(`${name}(${param})`);
      }
    }

    expect(
      offenders,
      "These take somebody's own words and do not store them. If a screen asks " +
        "for them, that screen is making a promise this function breaks — write " +
        "them to a column. If nothing asks, drop the parameter. Naming it in " +
        "DISCARDED is for a gap that genuinely needs a migration, and the entry " +
        "carries the fix.",
    ).toEqual([]);
  });

  it("names only functions that really do discard, and really do exist", () => {
    // A stale exception silently shrinks what the assertion above covers — the
    // `NOT_A_LABEL` shape. If one of these is fixed, this fails until the entry
    // goes, which is how the list stays a to-do rather than becoming furniture.
    const defs = latestDefinitions();

    for (const [name, fix] of Object.entries(DISCARDED)) {
      const def = defs.get(name);
      expect(def, `${name} is excused here but no longer exists`).toBeDefined();

      const sig = signatureOf(def!.body);
      const params = new Set(Array.from(sig.matchAll(REASON_PARAMS), (m) => m[0]));
      expect(params.size, `${name} no longer takes a reason at all`).toBeGreaterThan(0);
      expect(
        [...params].some((p) => !keepsIt(def!.body, p)),
        `${name} now keeps its reason — delete this entry rather than leaving it excused`,
      ).toBe(true);
      // The entry has to carry a repair, not just a name — otherwise the list
      // is a record that somebody noticed, which is the thing this codebase
      // keeps calling worse than no record.
      expect(fix, `${name} needs the fix written down, not just the name`).toMatch(/\bFix\b/);
      expect(fix.length, `${name}'s entry is too short to be a fix`).toBeGreaterThan(120);
    }
  });

  it("does not mistake a function that writes its reason for one that drops it", () => {
    // The instrument, checked against known-good bodies in both directions.
    // `mobile_revoke_device` sets `revoked_reason = coalesce(...)`;
    // `concession_revoke` writes it too. A guard whose detector is wrong reports
    // on its own bug rather than on the schema.
    const defs = latestDefinitions();
    for (const name of ["mobile_revoke_device", "concession_revoke", "notice_withdraw"]) {
      expect(keepsIt(defs.get(name)!.body, "p_reason"), `${name} does keep it`).toBe(true);
    }
    expect(keepsIt(defs.get("student_exit")!.body, "p_reason")).toBe(false);
  });
});
