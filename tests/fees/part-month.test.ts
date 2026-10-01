import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0317: a bus seat or hostel bed running for part of a billing period is
 * billed for the part it ran. Probed live in a rolled-back transaction: the
 * bed from 4 Sep billed "27 of 30 days = 4050.00" of a 4500.00 fare, a full
 * month's seat billed its fare unchanged (800.00), and with the setting off
 * the started month billed 4500.00.
 */
const M = readFileSync(join(process.cwd(), "supabase/migrations/0317_a_part_month_is_billed_by_the_day.sql"), "utf8")
  .replace(/--.*$/gm, "");

const body = (fn: string) => {
  const i = M.indexOf(`create or replace function public.${fn}(`);
  return M.slice(i, M.indexOf("$$;", i));
};

describe("part-month bus and hostel fees", () => {
  for (const fn of ["transport_fee_lines_for_period", "hostel_fee_lines_for_period"]) {
    it(`${fn} bills overlap, not the first day`, () => {
      const b = body(fn);
      expect(b).toMatch(/starts_on <= p_to/);
      expect(b).toMatch(/effective_ends_on >= p_from/);
      expect(b).toMatch(/least\(\w+\.effective_ends_on, p_to\) - greatest\(\w+\.starts_on, p_from\) \+ 1/);
      expect(b).toMatch(/round\(\w+\.monthly_fare \* x\.days \/ x\.of_days, 2\)/);
    });

    it(`${fn} reads the college's choice, defaulting to by-day`, () => {
      expect(body(fn)).toContain("coalesce((public.setting_value('fees.part_month') ->> 'by_days')::boolean, true)");
    });
  }

  it("the one definition uses the period functions only when the instalment has both dates", () => {
    const i = M.indexOf("create or replace function public.fees_billable_lines(");
    const b = M.slice(i);
    expect(b.match(/_fee_lines_for_period\(p_student_id, pp\.period_start, pp\.period_end\)/g)).toHaveLength(2);
    expect(b.match(/not exists \(select 1 from period pp where pp\.period_start is not null and pp\.period_end is not null\)/g)).toHaveLength(2);
  });

  it("the setting is declared, so a college can change it", () => {
    expect(M).toMatch(/'fees\.part_month',[\s\S]*?'\{"by_days": true\}'::jsonb/);
  });
});
