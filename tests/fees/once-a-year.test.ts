import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0336: a fee whose structure says one_time or annual is billed once a year,
 * on every path. Without it an invoice raised without a billing period billed
 * every head again: an admission fee billed on admission came back on the next
 * invoice (IN-2026-00001 and IN-2026-00003, 1,000.00 each, in a test college).
 */
const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

function latest(name: string): string {
  for (const f of [...files].reverse()) {
    const sql = readFileSync(join(dir, f), "utf8").replace(/--.*$/gm, "");
    const at = sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
    if (at >= 0) {
      const open = sql.indexOf("$$", at);
      return sql.slice(at, sql.indexOf("$$", open + 2));
    }
  }
  throw new Error(`${name} is defined nowhere`);
}

describe("a one-time or yearly fee is billed once a year", () => {
  const body = latest("fees_billable_lines");

  it("leaves out a once-a-year head already on an issued invoice this year", () => {
    expect(body).toMatch(/fs\.frequency in \('one_time', 'annual'\)/);
    const guard = body.slice(body.indexOf("fs.frequency in ('one_time', 'annual')"));
    expect(guard).toMatch(/i\.student_id = p_student_id/);
    expect(guard).toMatch(/i\.session_id = fs\.session_id/);
    // A cancelled invoice re-opens the fee.
    expect(guard).toMatch(/i\.status = 'issued'/);
    expect(guard).toMatch(/il\.fee_head_id = fs\.fee_head_id/);
  });

  it("does it in the one definition, before the instalment and ad-hoc paths part", () => {
    // In the class-fee branch, not behind `p_instalment_id is null`, so a
    // period that collects one-time fees cannot re-bill the admission fee.
    const branch = body.slice(0, body.indexOf("union all"));
    expect(branch).toContain("fs.frequency in ('one_time', 'annual')");
  });
});
