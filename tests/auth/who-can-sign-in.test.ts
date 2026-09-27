import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { passwordProblem, safeNext } from "@/lib/validations/password";
import { deleteErrorSentence, nothingDeletedSentence } from "@/lib/validations/errors";
import { judgeStaffRows, parseStaffCsv } from "@/lib/validations/staff-import";

/**
 * The audit's open list, closed (0289).
 *
 * - Who can sign in is a list an administrator can act on, and a leaver's login
 *   closes with them.
 * - A forgotten password has a way back; a known one can be changed.
 * - Four more deletes are refused by the database while history exists.
 * - A failed delete says a sentence, and a delete that removed nothing says so.
 * - Staff arrive from a spreadsheet.
 *
 * The DB suites need a sign-in this sandbox cannot make, so the SQL half is
 * read from the migrations with comments stripped -- a guard that reads prose
 * reports on the prose -- and resolved to the *latest* definition.
 */
const DIR = join(process.cwd(), "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const strip = (s: string) => s.replace(/--.*$/gm, "");
const SQL = FILES.map((f) => ({ f, sql: strip(readFileSync(join(DIR, f), "utf8")) }));
const ALL = SQL.map((s) => s.sql).join("\n");

function latest(name: string): { header: string; body: string } {
  for (const { sql } of [...SQL].reverse()) {
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    const m = [...sql.matchAll(re)].pop();
    if (!m) continue;
    const start = sql.indexOf("$$", m.index!);
    const end = sql.indexOf("$$", start + 2);
    return { header: sql.slice(m.index!, start), body: sql.slice(start + 2, end) };
  }
  throw new Error(`${name} is defined nowhere`);
}

const src = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("who can sign in", () => {
  it("team_logins is a definer that gates on users.manage and filters the tenant itself", () => {
    const { header, body } = latest("team_logins");
    expect(header).toMatch(/security definer/);
    // Inside a definer no policy runs, so the tenant predicate IS the isolation.
    expect(body).toMatch(/where up\.tenant_id = v_tenant/);
    expect(body).toMatch(/v_tenant uuid := public\.current_tenant_id\(\)/);
    expect(body).toMatch(/role_has_permission\('users\.manage'\)/);
    expect(ALL).toMatch(/revoke all on function public\.team_logins\(\) from public, anon;/);
  });

  for (const fn of ["login_set_access", "login_set_role"]) {
    it(`${fn} refuses the caller acting on themselves and keeps a way back`, () => {
      const { header, body } = latest(fn);
      expect(header).toMatch(/security definer/);
      expect(body).toMatch(/role_has_permission\('users\.manage'\)/);
      expect(body).toMatch(/p_user_id = auth\.uid\(\)/);
      expect(body).toMatch(/logins_that_can_manage_users\(v_tenant, p_user_id\) = 0/);
      // Tenant by hand: a user id from another college must match nothing.
      expect(body).toMatch(/tenant_id = v_tenant/);
    });
  }

  it("the mechanisms are revoked from everybody holding a JWT", () => {
    for (const sig of [
      "login_close\\(uuid, uuid, boolean\\)",
      "logins_that_can_manage_users\\(uuid, uuid\\)",
      "staff_leaving_closes_logins\\(\\)",
    ]) {
      expect(ALL).toMatch(new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated`));
    }
  });

  it("switching off is three things: the profile, the ban and the sessions", () => {
    const { body } = latest("login_close");
    expect(body).toMatch(/update public\.user_profiles set is_active = p_active/);
    expect(body).toMatch(/banned_until = case when p_active then null else 'infinity'::timestamptz end/);
    expect(body).toMatch(/delete from auth\.sessions where user_id = p_user/);
  });

  it("a leaver's login closes with them, through the one mechanism", () => {
    expect(ALL).toMatch(
      /create trigger staff_leaving_closes_logins\s+after update of status on public\.staff\s+for each row execute function public\.staff_leaving_closes_logins\(\)/,
    );
    const { body } = latest("staff_leaving_closes_logins");
    expect(body).toMatch(/old\.status = 'active' and new\.status <> 'active'/);
    expect(body).toMatch(/perform public\.login_close\(new\.tenant_id, u\.id, false\)/);
  });

  it("the team screen mounts the list, and the staff record offers a login", () => {
    expect(src("src/app/(app)/settings/team/page.tsx")).toMatch(/<LoginsPanel logins=\{logins\}/);
    expect(src("src/app/(app)/staff/[id]/page.tsx")).toMatch(/<GiveLoginControl/);
  });
});

describe("a password has a way back", () => {
  it("the sign-in page links to the reset, and a banned login is told so", () => {
    expect(src("src/app/login/login-form.tsx")).toMatch(/href="\/auth\/forgot"/);
    expect(src("src/app/login/actions.ts")).toMatch(/error\.code === "user_banned"/);
  });

  it("the reset is requested through Supabase and lands on the callback", () => {
    const actions = src("src/app/auth/actions.ts");
    expect(actions).toMatch(/resetPasswordForEmail\(/);
    expect(actions).toMatch(/\/auth\/callback\?next=/);
    // The answer never says whether the address has a login.
    expect(actions).not.toMatch(/sent:\s*false/);
    expect(src("src/app/auth/callback/route.ts")).toMatch(/safeNext\(url\.searchParams\.get\("next"\)\)/);
  });

  it("change password proves the current one first", () => {
    const actions = src("src/app/(app)/account/actions.ts");
    const verify = actions.indexOf("signInWithPassword");
    const update = actions.indexOf("updateUser");
    expect(verify).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(verify);
  });

  it("safeNext keeps a link inside the app", () => {
    expect(safeNext("/auth/reset")).toBe("/auth/reset");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(null, "/login")).toBe("/login");
  });

  it("passwordProblem checks length before agreement", () => {
    expect(passwordProblem("short", "short")).toBe("tooShort");
    expect(passwordProblem("long enough", "long enougH")).toBe("mismatch");
    expect(passwordProblem("long enough", "long enough")).toBeNull();
  });
});

describe("four more deletes are refused while history exists", () => {
  // A paper's exemption is its parent: when the exam (or the college) is
  // already gone, the paper goes with it.
  const COLLEGE_GONE = /not exists \(select 1 from public\.tenants where id = old\.tenant_id\)/;
  const EXAM_GONE = /if v_exam\.id is null then\s+return old;/;
  for (const [table, fn, holds, exempt] of [
    ["exams", "guard_exam_delete", /old\.status = 'published'/, COLLEGE_GONE],
    ["exam_subjects", "guard_exam_paper_delete", /v_exam\.status = 'published'/, EXAM_GONE],
    ["homework", "guard_homework_delete", /status in \('graded', 'returned'\)/, COLLEGE_GONE],
    ["time_slots", "guard_time_slot_delete", /public\.substitutions/, COLLEGE_GONE],
    ["books", "guard_book_delete", /public\.book_issues/, COLLEGE_GONE],
  ] as const) {
    it(`${table} is guarded by ${fn}`, () => {
      expect(ALL).toMatch(
        new RegExp(`create trigger ${fn} before delete on public\\.${table}\\s+for each row execute function public\\.${fn}\\(\\)`),
      );
      const { header, body } = latest(fn);
      expect(header).toMatch(/security definer/);
      expect(body).toMatch(exempt);
      expect(body).toMatch(holds);
      expect(body).toMatch(/errcode = 'P0001'/);
      expect(ALL).toMatch(new RegExp(`revoke all on function public\\.${fn}\\(\\) from public, anon, authenticated`));
    });
  }

  it("homework's files are removed only after the row is", () => {
    const actions = src("src/app/(app)/homework/actions.ts");
    const fn = actions.slice(actions.indexOf("export async function deleteHomework"));
    const del = fn.indexOf('.from("homework").delete()');
    const remove = fn.indexOf("removeFile(");
    expect(del).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(del);
  });
});

describe("a failed delete says a sentence", () => {
  const SITES: [string, string, string][] = [
    ["src/app/(app)/academics/actions.ts", "deleteClassRoom", "class_rooms"],
    ["src/app/(app)/academics/actions.ts", "deleteTimeSlot", "time_slots"],
    ["src/app/(app)/exams/actions.ts", "deleteExam", "exams"],
    ["src/app/(app)/exams/actions.ts", "deletePaper", "exam_subjects"],
    ["src/app/(app)/homework/actions.ts", "deleteHomework", "homework"],
    ["src/app/(app)/fees/actions.ts", "deleteFeeStructure", "fee_structures"],
    ["src/app/(app)/library/actions.ts", "deleteBook", "books"],
  ];
  for (const [file, name, table] of SITES) {
    it(`${name} translates the error and counts what it removed`, () => {
      const text = src(file);
      const start = text.indexOf(`export async function ${name}(`);
      const body = text.slice(start, text.indexOf("\nexport ", start + 10));
      expect(body).toMatch(new RegExp(`\\.from\\("${table}"\\)\\.delete\\(\\)\\.eq\\("id", id\\)\\.select\\("id"\\)`));
      expect(body).toMatch(/deleteErrorSentence\(error,/);
      expect(body).toMatch(/nothingDeletedSentence\(/);
      expect(body).not.toMatch(/error:\s*error\.message|fail\(error\.message\)/);
    });
  }

  it("keeps a guard's own sentence and names the table still holding a reference", () => {
    const guard = "Atlas cannot be deleted: it has been lent 2 times.";
    expect(deleteErrorSentence({ code: "P0001", message: guard }, "this book")).toBe(guard);
    expect(
      deleteErrorSentence(
        {
          code: "23503",
          message:
            'update or delete on table "books" violates foreign key constraint "x_fkey" on table "ledger_entries"',
        },
        "this book",
      ),
    ).toBe("This book cannot be deleted: records in ledger entries still refer to it.");
    expect(deleteErrorSentence({ code: "42501", message: "denied" }, "this exam")).toBe(
      "Your role may not delete this exam.",
    );
    expect(nothingDeletedSentence("this room")).toMatch(/^Nothing was deleted/);
  });
});

describe("staff from a spreadsheet", () => {
  const CSV = [
    "First name,Last name,Emp Code,Designation,DOJ,Sex,Mobile,Shoe size",
    'Anita,Sharma,T-1,Teacher,12/06/2024,F,98765,9',
    '"Rao, jr",Kiran,T-1,Clerk,2024-13-40,x,1,10',
  ].join("\n");

  it("matches headings loosely and reports what it ignored", () => {
    const parsed = parseStaffCsv(CSV);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.unmatched).toEqual(["Shoe size"]);
    expect(parsed.rows[1].firstName).toBe("Rao, jr");
    expect(parsed.rows[0].employeeCode).toBe("T-1");
  });

  it("judges every row against every other: a shared code is on both", () => {
    const parsed = parseStaffCsv(CSV);
    if (!parsed.ok) throw new Error(parsed.error);
    const problems = judgeStaffRows(parsed.rows);
    const [a, b] = parsed.rows.map((r) => problems.get(r.key) ?? []);
    expect(a.some((p) => p.includes("more than once"))).toBe(true);
    expect(b.some((p) => p.includes("more than once"))).toBe(true);
    expect(b.some((p) => p.includes("is not a date"))).toBe(true);
    expect(b.some((p) => p.includes("is not a gender"))).toBe(true);

    parsed.rows[1].employeeCode = "T-2";
    parsed.rows[1].dateOfJoining = "01/07/2024";
    parsed.rows[1].gender = "m";
    const again = judgeStaffRows(parsed.rows);
    expect(again.get(parsed.rows[0].key)).toEqual([]);
    expect(again.get(parsed.rows[1].key)).toEqual([]);
  });

  it("refuses a missing required column and an oversized file rather than cutting it", () => {
    expect(parseStaffCsv("First name,Last name\nA,B").ok).toBe(false);
    const big = ["First name,Last name,Employee code,Designation,Date of joining"]
      .concat(Array.from({ length: 201 }, (_, i) => `A,B,C${i},T,2024-06-01`))
      .join("\n");
    const parsed = parseStaffCsv(big);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/201 rows/);
  });

  it("adds through staff_admit, the same function the form uses, and is linked", () => {
    expect(src("src/app/(app)/staff/import/actions.ts")).toMatch(/supabase\.rpc\("staff_admit"/);
    expect(src("src/app/(app)/staff/import/actions.ts")).toMatch(/staffSchema\.safeParse/);
    expect(src("src/app/(app)/staff/page.tsx")).toMatch(/href="\/staff\/import"/);
  });

  it("the browser half stays free of Zod", () => {
    for (const f of ["src/lib/validations/staff-import.ts", "src/lib/validations/csv.ts", "src/lib/validations/errors.ts", "src/lib/validations/password.ts"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8")).not.toMatch(/from "zod"/);
    }
  });
});

describe("the library and the store can name their categories", () => {
  it("library members can be added and suspended", () => {
    expect(src("src/app/(app)/library/members/add-member-dialog.tsx")).toMatch(/createMember\(/);
    expect(src("src/app/(app)/library/members/members-table.tsx")).toMatch(/setMemberStatus\(/);
  });

  it("one categories dialog, used by both modules with their own actions", () => {
    const books = src("src/app/(app)/library/books/page.tsx");
    const store = src("src/app/(app)/inventory/page.tsx");
    expect(books).toMatch(/<CategoriesDialog/);
    expect(books).toMatch(/saveBookCategory/);
    expect(store).toMatch(/<CategoriesDialog/);
    expect(store).toMatch(/deleteCategory/);
    // Rule 8's split: the shared control takes its actions as props.
    expect(src("src/components/forms/categories-dialog.tsx")).not.toMatch(/from "@\/app\//);
  });

  it("a fee head can be edited", () => {
    expect(src("src/app/(app)/fees/setup/fee-setup.tsx")).toMatch(/setEditingHead\(/);
  });
});
