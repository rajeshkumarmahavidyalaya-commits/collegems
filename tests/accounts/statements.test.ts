import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0311 and 0312, pinned without a database. The live half was probed as an
 * administrator on 1 Oct 2026: income 38,59,200 less expenditure 45,200 is a
 * surplus of 38,14,000; the balance sheet's assets (38,14,000) equal its
 * liabilities, funds and reserves (0 + 38,14,000 unclosed surplus). A bulk
 * award of four children awarded three and refused the fourth in the single
 * award's own words; a repeat was refused by name.
 */
const DIR = join(process.cwd(), "supabase/migrations");
const sql = (f: string) => readFileSync(join(DIR, f), "utf8").replace(/--.*$/gm, "");
const M311 = sql("0311_statements_and_a_register_of_leavers.sql");
const M312 = sql("0312_a_concession_for_a_whole_list.sql");

describe("the statements", () => {
  it("read posted vouchers only, as the caller (RLS decides who sees the books)", () => {
    for (const fn of ["report_income_expenditure", "report_balance_sheet"]) {
      const body = M311.slice(M311.indexOf(`function public.${fn}`));
      expect(body.slice(0, body.indexOf("$$;"))).toMatch(/v\.status = 'posted'/);
      expect(body.slice(0, body.indexOf("$$;"))).not.toMatch(/security definer/i);
    }
  });

  it("the balance sheet carries the unclosed surplus, which is what makes it balance", () => {
    expect(M311).toMatch(/'Surplus not yet closed into reserves', unclosed/);
    expect(M311).toMatch(/liabilities \+ equity \+ unclosed/);
  });

  it("are catalogued for the people who may read the books", () => {
    expect(M311).toMatch(/'Accounts', 'accounts\.view', 'report_income_expenditure'/);
    expect(M311).toMatch(/'Accounts', 'accounts\.view', 'report_balance_sheet'/);
    expect(M311).toMatch(/'Students', 'students\.view', 'report_student_leavers'/);
  });
});

describe("a concession for a whole list", () => {
  it("awards each child through the single award, in its own sub-transaction", () => {
    expect(M312).toMatch(/perform public\.concession_award\(v_student, p_concession_id, p_reason, p_ends_on\);/);
    expect(M312).toMatch(/exception when others then\s+v_refused := v_refused \|\|/);
    expect(M312).not.toMatch(/insert into public\.student_concessions/);
  });

  it("is bounded, and not callable without signing in", () => {
    expect(M312).toMatch(/cardinality\(p_student_ids\) > 500/);
    expect(M312).toMatch(/revoke all on function public\.concession_award_many\(uuid, uuid\[\], text, date\) from public, anon;/);
  });
});

describe("a year closes into reserves (0313)", () => {
  const M313 = sql("0313_a_year_closes_into_reserves.sql");

  it("is one posted voucher, through the ordinary post, and refuses a second close", () => {
    expect(M313).toMatch(/'draft', 'year_close', auth\.uid\(\)\)/);
    expect(M313).toMatch(/v_number := public\.accounts_post_voucher\(v_id\);/);
    expect(M313).toMatch(/if v_later is not null and v_later >= p_to then/);
    expect(M313).toMatch(/pg_advisory_xact_lock/);
  });

  it("reopens by reversing on the close's own date", () => {
    expect(M313).toMatch(/accounts_reverse_voucher\(\s*p_voucher_id, v_close\.voucher_date,/);
  });

  it("is gated on accounts.manage, and the income statement leaves closes out", () => {
    expect(M313.match(/current_role_allows\('accounts\.manage'\)/g)?.length).toBe(2);
    expect(M313).toMatch(/and v\.source_kind <> 'year_close'\s+and coalesce\(o\.source_kind, ''\) <> 'year_close'/);
  });
});
