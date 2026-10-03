import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupByDay, kindLabel, monthWindow } from "@/lib/validations/calendar";
import { NAV_GROUPS } from "@/components/app-shell/nav-config";

/**
 * The office's everyday screens WPSchool has and this product lacked (0297,
 * 0298): an expense in one form, four reports, and a school calendar.
 */
const ROOT = process.cwd();
const DIR = join(ROOT, "supabase/migrations");
const strip = (s: string) => s.replace(/--.*$/gm, "");
const SQL = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ f, sql: strip(readFileSync(join(DIR, f), "utf8")) }));
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

describe("an expense or an income in one form", () => {
  const { file, header, body } = latest("accounts_record_cash");

  it("is an invoker that needs accounts.post and posts through the one posting function", () => {
    expect(file).toMatch(/^0298_/);
    expect(header).not.toMatch(/security definer/);
    expect(body).toMatch(/if not public\.current_role_allows\('accounts\.post'\) then\s+raise exception/);
    expect(body).toMatch(/v_number := public\.accounts_post_voucher\(v_id\);/);
    expect(ALL).toMatch(
      /revoke all on function public\.accounts_record_cash\(text, uuid, uuid, numeric, date, text\) from public, anon;/,
    );
  });

  it("files the voucher where the voucher book's other door does (0298)", () => {
    expect(body).toMatch(/v_session := public\.current_session_id\(v_tenant\);/);
    expect(body).not.toMatch(/v_session := public\.academics_session_for_date/);
  });

  it("does not report a voucher that stayed a draft as posted (rule 6)", () => {
    expect(body).toMatch(/v\.status = 'posted';\s+if not found then\s+raise exception/);
  });

  it("is drawn only for somebody who may post", () => {
    const page = src("src/app/(app)/accounts/page.tsx");
    expect(page).toMatch(/\{canPost && moneyAccounts\.length > 0 && \(/);
    expect(src("src/app/(app)/accounts/actions.ts")).toMatch(/rpc\("accounts_record_cash"/);
  });
});

describe("four reports", () => {
  const cases: [string, string, string][] = [
    ["exams.subjects", "exams.grade", "report_exam_subjects"],
    ["hostel.residents", "hostel.allocate", "report_hostel_residents"],
    ["inventory.stock", "inventory.view", "report_inventory_stock"],
    ["frontoffice.enquiries", "frontoffice.view", "report_enquiries"],
  ];

  it.each(cases)("%s is catalogued on %s, for staff, over an invoker with no hand tenant filter", (key, perm, fn) => {
    expect(ALL).toMatch(new RegExp(`'${key.replace(".", "\\.")}',[^;]*?'${perm.replace(".", "\\.")}', '${fn}'`));
    const { header, body } = latest(fn);
    expect(header).not.toMatch(/security definer/);
    expect(body).not.toMatch(/tenant_id\s*=/);
    // A total order: an export pages this with limit/offset (rule 7).
    expect(body).toMatch(/order by [^\n]*\b(id|x\.id, sec\.id|a\.id|item_id|q\.id)\b/);
  });

  it("the paper report reads the engine's verdict, never re-marks", () => {
    const { body } = latest("report_exam_subjects");
    expect(body).toMatch(/jsonb_array_elements\(coalesce\(r\.detail, '\[\]'::jsonb\)\)/);
    expect(body).not.toMatch(/public\.marks\b/);
  });

  it("the paper report counts only children the caller can place in a class (0299)", () => {
    // exam_results is school-wide for staff and enrolments are row-owned, so a
    // left join gave a teacher a class-less row of 272 children (rule 4).
    const { file, body } = latest("report_exam_subjects");
    expect(file).toMatch(/^0299_/);
    expect(body).toMatch(/\n\s*join public\.enrolments e\s/);
    expect(body).not.toMatch(/left join public\.(enrolments|sections|class_levels)/);
  });

  it("the stock report asks the store's own function (quantity is a sum, never a column)", () => {
    expect(latest("report_inventory_stock").body).toMatch(/from public\.stock_on_hand\(/);
  });
});

describe("the school calendar", () => {
  it("is an invoker over the dates the school already keeps, capped at 400 days", () => {
    const { header, body } = latest("school_calendar");
    expect(header).not.toMatch(/security definer/);
    for (const t of ["holidays", "exams", "fee_instalments", "notices"]) {
      expect(body).toMatch(new RegExp(`from public\\.${t}\\b`));
    }
    expect(body).toMatch(/least\(p_from, p_to\) \+ 400/);
    // 0298: a notice with no start date starts the day it was published.
    expect(body).toMatch(/coalesce\(n\.starts_on, \(n\.published_at at time zone 'Asia\/Kolkata'\)::date\)/);
  });

  it("walks months across a year and a leap February", () => {
    expect(monthWindow("2026-12", "2026-09-29")).toMatchObject({ from: "2026-12-01", to: "2026-12-31", next: "2027-01", prev: "2026-11" });
    expect(monthWindow("2026-01", "2026-09-29").prev).toBe("2025-12");
    expect(monthWindow("2028-02", "2026-09-29").to).toBe("2028-02-29");
    expect(monthWindow("2027-02", "2026-09-29").to).toBe("2027-02-28");
  });

  it("opens on this month for a mangled link rather than an error", () => {
    expect(monthWindow("nonsense", "2026-09-29").month).toBe("2026-09");
    expect(monthWindow("2026-13", "2026-09-29").month).toBe("2026-09");
    expect(monthWindow(undefined, "2026-09-29")).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("shows a range that began last month on the first day of this one, once", () => {
    const days = groupByDay(
      [
        { starts_on: "2026-08-28", ends_on: "2026-09-05", kind: "holiday", title: "Autumn break", detail: null, href: null },
        { starts_on: "2026-09-10", ends_on: "2026-09-10", kind: "fee_due", title: "September due", detail: null, href: "/fees/instalments" },
      ],
      "2026-09-01",
    );
    expect(days.map(([d, e]) => [d, e.length])).toEqual([
      ["2026-09-01", 1],
      ["2026-09-10", 1],
    ]);
  });

  it("names a kind it does not know as itself, never hides it", () => {
    const t = (k: string) => `T:${k}`;
    expect(kindLabel("exam", t as never)).toBe("T:calendar.kind.exam");
    expect(kindLabel("sports_day", t as never)).toBe("sports_day");
  });

  it("is on the menu for everybody, and the page decides nothing about roles", () => {
    const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/calendar");
    expect(item).toBeDefined();
    expect(item!.roles).toBeUndefined();
    const page = src("src/app/(app)/calendar/page.tsx");
    expect(page).toMatch(/rpc\("school_calendar"/);
    expect(page).not.toMatch(/roleCode|roleTier|hasPermission/);
  });

  it("draws its Add Event / Add Holiday buttons from a component that reads nothing", () => {
    // The buttons are gated on the permission each destination checks; the
    // calendar's entries stay decided by school_calendar() alone.
    const actions = src("src/components/calendar/calendar-actions.tsx");
    expect(actions).toMatch(/hasPermission\("notices\.manage"\)/);
    expect(actions).toMatch(/hasPermission\("academics\.manage"\)/);
    expect(actions).not.toMatch(/\.rpc\(|\.from\(|createClient/);
  });
});
