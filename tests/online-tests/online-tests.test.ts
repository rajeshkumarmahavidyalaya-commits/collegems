import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GRACE_MS,
  formatRemaining,
  scoreText,
  sittingState,
  sittingStateLabel,
} from "@/lib/validations/online-tests-display";
import { questionSchema } from "@/lib/validations/online-tests";
import type { Translator } from "@/lib/i18n/translate";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const APP = join(ROOT, "src", "app", "(app)", "online-tests");

/** Comments out, then match: a comment can hide a violation and fake one. */
function sql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const ALL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => sql(readFileSync(join(MIGRATIONS, f), "utf8")))
  .join("\n");

/** The latest definition, anchored on `create ... function`, never on a comment. */
function functionBody(name: string): string {
  let found = "";
  const pattern = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(ALL)) !== null) {
    const rest = ALL.slice(m.index);
    found = rest.slice(0, rest.indexOf("\n$$;"));
  }
  return found;
}

/** Every `create policy` on a table, whole, up to its terminating semicolon. */
function policiesOn(table: string): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`create policy "[^"]+" on public\\.${table}\\b[^;]*;`, "g");
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(ALL)) !== null) out.push(m[0]);
  return out;
}

/**
 * Online tests (migration 0274). The answer key is a column of the question
 * row, and RLS cannot restrict columns -- so the whole design is about who can
 * reach that row, and every assertion here is one of those doors.
 */
describe("the answer key never reaches a student", () => {
  it("no policy on the questions admits a student or a parent", () => {
    // Strip the policy's name first: a name is prose, and "students" in a
    // policy called "...for students" is not a predicate.
    const policies = policiesOn("online_test_questions").map((p) => p.replace(/create policy "[^"]+"/, ""));
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      expect(p, `a policy on the questions mentions a family seat:\n${p}`).not.toMatch(/'(student|parent)'/);
      expect(p).not.toMatch(/role_has_permission\('onlinetests\.view'\)/);
    }
  });

  it("the paper a student is given projects everything but the key", () => {
    const paper = functionBody("online_test_paper");
    expect(paper).toContain("'prompt', q.prompt");
    expect(paper).not.toContain("correct_option");
  });

  it("only the marker, the review, the results and the question writer read the key", () => {
    const readers = ["online_test_score", "online_test_review", "online_test_results", "online_test_save_question"];
    const others = [
      "online_test_paper",
      "online_test_start",
      "online_test_save",
      "online_test_submit",
      "online_test_my_sitting",
      "online_test_clean_answers",
      "online_test_finish",
      "online_tests_list",
    ];
    for (const r of readers) expect(functionBody(r), r).toContain("correct_option");
    for (const o of others) expect(functionBody(o), o).not.toContain("correct_option");
  });

  it("the review refuses before the test closes for everybody", () => {
    const review = functionBody("online_test_review");
    expect(review).toMatch(/if now\(\) < v_test\.closes_at then\s+raise exception/);
    expect(review).toMatch(/if not v_test\.reveal_answers then\s+raise exception/);
  });

  it.each([
    "online_test_score",
    "online_test_paper",
    "online_test_clean_answers",
    "online_test_my_sitting",
    "online_test_finish",
  ])("%s is internal: revoked from everybody holding a JWT", (name) => {
    const revoke = new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`);
    expect(ALL).toMatch(revoke);
    expect(ALL).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\(`));
  });
});

describe("a student cannot write their own mark", () => {
  it("the attempts are revoked from JWT roles and carry no write policy", () => {
    expect(ALL).toMatch(/revoke insert, update, delete on public\.online_test_attempts from authenticated, anon;/);
    for (const p of policiesOn("online_test_attempts")) {
      expect(p, `a write policy on the attempts:\n${p}`).toMatch(/for select to authenticated/);
    }
  });

  it("marking happens in exactly one function, and submit goes through it", () => {
    expect(functionBody("online_test_finish")).toContain("public.online_test_score(");
    expect(functionBody("online_test_submit")).toContain("public.online_test_finish(");
    // The only place an answer is compared with the key for a mark.
    const comparers = ["online_test_score", "online_test_results"].filter((f) =>
      /\) = q\.correct_option::text/.test(functionBody(f)),
    );
    expect(comparers).toEqual(["online_test_score", "online_test_results"]);
    expect(functionBody("online_test_results")).toContain("public.online_test_score(");
  });
});

describe("the key is frozen once published (rule 4's device)", () => {
  it("questions carry the test's status through the key, and the write policies require a draft", () => {
    expect(ALL).toMatch(
      /foreign key \(tenant_id, test_id, test_status\)\s+references public\.online_tests \(tenant_id, id, status\)\s+on update cascade/,
    );
    const writers = policiesOn("online_test_questions").filter((p) => /for all to authenticated/.test(p));
    expect(writers).toHaveLength(2);
    for (const p of writers) expect((p.match(/test_status = 'draft'/g) ?? []).length).toBe(2);
  });

  it("an attempt can only point at a published test, so unpublishing a started one is refused", () => {
    expect(ALL).toMatch(/test_status text not null default 'published' check \(test_status = 'published'\)/);
    expect(ALL).toMatch(
      /foreign key \(tenant_id, test_id, session_id, test_status\)\s+references public\.online_tests \(tenant_id, id, session_id, status\)\s+on update cascade on delete restrict/,
    );
  });
});

describe("the results read model is a definer that filters by tenant itself", () => {
  const results = functionBody("online_test_results");

  it("is a definer, and every table it reads is narrowed to the caller's tenant", () => {
    expect(results).toMatch(/security definer\s+set search_path = ''/);
    expect(results).toContain("t.tenant_id = v_tenant");
    for (const alias of ["e.tenant_id = v_tenant", "a.tenant_id = v_tenant", "st.tenant_id = v_tenant", "p.tenant_id = v_tenant", "q.tenant_id = v_tenant"]) {
      expect(results, alias).toContain(alias);
    }
  });

  it("refuses rather than returning empty", () => {
    expect(results).toMatch(/raise exception 'Only the teacher of this test/);
  });
});

describe("the clock", () => {
  it("the browser's grace is the database's, in every function that applies one", () => {
    expect(GRACE_MS).toBe(2 * 60_000);
    for (const f of ["online_test_start", "online_test_save", "online_test_submit", "online_test_results"]) {
      const body = functionBody(f);
      expect(body, f).toContain("interval '2 minutes'");
      expect(body.match(/interval '\d+ minutes?'/g)?.every((i) => i === "interval '2 minutes'"), f).toBe(true);
    }
  });

  it("the due time is frozen at the start: the duration, or the close if sooner", () => {
    expect(functionBody("online_test_start")).toContain(
      "least(now() + make_interval(mins => v_test.duration_minutes), v_test.closes_at)",
    );
  });

  it.each([
    [null, "not_started"],
    [{ submittedAt: "2026-10-01T05:00:00Z", dueAt: "2026-10-01T05:30:00Z" }, "submitted"],
    [{ submittedAt: null, dueAt: "2026-10-01T05:30:00Z" }, "in_progress"],
  ] as const)("a sitting %j at 05:31:59 is %s", (attempt, expected) => {
    expect(sittingState(attempt, Date.parse("2026-10-01T05:31:59Z"))).toBe(expected);
  });

  it("is lapsed only once the grace has passed too", () => {
    const a = { submittedAt: null, dueAt: "2026-10-01T05:30:00Z" };
    expect(sittingState(a, Date.parse("2026-10-01T05:32:00Z"))).toBe("in_progress");
    expect(sittingState(a, Date.parse("2026-10-01T05:32:01Z"))).toBe("lapsed");
  });

  it.each([
    [0, "0:00"],
    [59_000, "0:59"],
    [5 * 60_000 + 7_000, "5:07"],
    [3_723_000, "1:02:03"],
    [-4_000, "0:00"],
  ])("%d ms left reads %s", (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });
});

describe("the screens", () => {
  it("the test's page never loads the paper: reading the questions starts the clock", () => {
    const page = readFileSync(join(APP, "[id]", "page.tsx"), "utf8");
    expect(page).not.toMatch(/\bstartTest\b/);
    const paper = readFileSync(join(APP, "paper.tsx"), "utf8");
    // Called once, inside the Begin handler -- never on render or in an effect.
    expect(paper.match(/await startTest\(/g)).toHaveLength(1);
    const begin = paper.slice(paper.indexOf("function begin()"), paper.indexOf("function showReview()"));
    expect(begin).toContain("await startTest(");
  });

  it("the question editor ships no Zod; the create dialog is the only screen that validates in the browser", () => {
    const editor = readFileSync(join(APP, "editor.tsx"), "utf8");
    const paper = readFileSync(join(APP, "paper.tsx"), "utf8");
    for (const src of [editor, paper]) {
      expect(src).not.toMatch(/from "zod"|validations\/online-tests"/);
    }
  });

  it("a mark always travels with its maximum", () => {
    expect(scoreText(3, 4)).toBe("3 of 4");
    expect(scoreText(2.5, 4)).toBe("2.5 of 4");
    expect(scoreText(null, 4)).toBe("—");
  });

  it("an unknown sitting state is shown as the value, not as a key", () => {
    const t = ((key: string) => key) as unknown as Translator;
    expect(sittingStateLabel("paused", t)).toBe("paused");
    expect(sittingStateLabel("lapsed", t)).toBe("Time ran out");
  });

  it("the question schema drops blank options and keeps the key in range", () => {
    const ok = questionSchema.safeParse({ prompt: "2+2", options: ["3", "", "4"], correctOption: 1, marks: 1 });
    expect(ok.success && ok.data.options).toEqual(["3", "4"]);
    expect(questionSchema.safeParse({ prompt: "2+2", options: ["3", "4"], correctOption: 2, marks: 1 }).success).toBe(false);
  });
});
