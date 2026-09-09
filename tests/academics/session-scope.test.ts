import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rule 2's executable half, for the application layer.
 *
 * `session_id` is on every transactional table so a reader can filter without a
 * join — and **RLS never enforces it**. A policy answers which tenant and whose
 * rows; the year is a label, and a label is only as good as the reader. So a
 * list read with no session filter is invisible until a school rolls a year
 * forward, and then it quietly serves two years at once. `listSections()` was
 * that for seventeen screens.
 *
 * The guard is on the omission, exactly as `nav-audience.test.ts` is: a
 * whole-table read of a session-scoped table must be **named here with the
 * reason it is deliberately cross-year**. Adding an entry is a decision
 * somebody makes on purpose; forgetting one fails the test.
 *
 * The question to ask of a new list is the one that settles every entry below:
 * **is this list "now", or is it "ever"?**
 */
const CROSS_YEAR_ON_PURPOSE: Record<string, string> = {
  "src/app/(app)/accounts/actions.ts:journal_vouchers":
    "Rule 6: the accounts module is date-ranged, never session-filtered. A voucher book that hid last March would not reconcile.",
  "src/app/(app)/certificates/actions.ts:certificates":
    "A certificate register is a history. A leaving certificate issued in 2024 has to stay findable in 2034.",
  "src/app/(app)/library/actions.ts:book_issues":
    "A book issued last year and still not returned is exactly the row a librarian is looking for.",
  "src/app/(app)/hr/actions.ts:leave_requests":
    "Staff leave is a record of what was taken, and a balance is derived from all of it.",
  "src/app/(app)/payroll/actions.ts:payroll_runs":
    "A run history. Last year's finalised runs are the payslips people ask about.",
  "src/app/(app)/notices/actions.ts:notices":
    "Rule 10: a notice is a document with an audience, and the board's whole point is coming back to it in March to check what the circular said.",
  "src/app/(app)/exams/actions.ts:exams":
    "Counts how many exams use each grading scheme, so deletion can be honest. A scheme last year's exam used is not free to delete.",
  "src/app/(app)/academics/actions.ts:section_subjects":
    "Same shape: counts how many class-section slots reference a subject, for the same deletion question.",
  "src/app/(app)/transport/actions.ts:transport_routes":
    "Same shape again: whether a vehicle is referenced by any route, across years, which is the conservative direction.",
  "src/app/(app)/promotion/actions.ts:sections":
    "Promotion is the module whose entire job spans two years. Filtering it to one would be filtering out the destination.",
};

const TABLES = `attendance_records book_issues certificates enquiries enrolments
exam_components exam_remarks exam_results exam_subjects exams fee_instalments fee_structures
holidays homework homework_submissions hostel_allocations invoice_lines invoices
journal_vouchers leave_requests ledger_entries marks notices notifications payment_intents
payroll_runs route_stops section_subjects sections staff_attendance stock_movements
student_concessions student_leave_requests study_material substitutions timetable_entries
transport_assignments transport_routes visitors`.split(/\s+/);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(path) && !path.includes("database.types")) out.push(path);
  }
  return out;
}

/** The function body a position sits in — not the statement, because this
 *  codebase builds a query across several (`let q = …; if (x) q = q.eq(…)`). */
function enclosing(src: string, pos: number): string {
  const starts = [...src.matchAll(/^(export )?(async )?function |^(export )?const \w+ = /gm)].map(
    (m) => m.index ?? 0,
  );
  const before = starts.filter((s) => s <= pos);
  const after = starts.filter((s) => s > pos);
  return src.slice(before.at(-1) ?? 0, after[0] ?? src.length);
}

describe("a list of this year's rows says which year it means", () => {
  it("names every whole-table read of a session-scoped table", () => {
    const pattern = new RegExp(`\\.from\\("(${TABLES.join("|")})"\\)`, "g");
    const undeclared: string[] = [];

    for (const path of walk("src")) {
      const src = readFileSync(path, "utf8");
      for (const m of src.matchAll(pattern)) {
        const table = m[1];
        const at = m.index ?? 0;
        if (enclosing(src, at).includes("session_id")) continue;

        // A read narrowed by a key, or a single-row lookup, needs no year:
        // the id names the row.
        const tail = src.slice(at + m[0].length, at + m[0].length + 1500);
        const stmt = tail.slice(0, tail.indexOf(";") > 0 ? tail.indexOf(";") : 1500);
        if (!stmt.includes(".select(")) continue;
        if (/\.(eq|in|in_|match)\(\s*"[a-z_]+"/.test(stmt)) continue;
        if (/\.(single|maybeSingle)\(/.test(stmt)) continue;

        const key = `${path.replace(/\\/g, "/")}:${table}`;
        if (!(key in CROSS_YEAR_ON_PURPOSE)) {
          undeclared.push(`${key} (line ${src.slice(0, at).split("\n").length})`);
        }
      }
    }

    expect(
      undeclared,
      "These read a session-scoped table with no year and no key. Ask whether the " +
        "list means 'now' or 'ever': filter on the session, or add it to " +
        "CROSS_YEAR_ON_PURPOSE with the reason.",
    ).toEqual([]);
  });
});
