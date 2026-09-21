import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The syllabus.
 *
 * The shape of this module is one decision, and getting it backwards would be
 * the expensive mistake rather than a bug:
 *
 *     syllabus_units      (session, class level, subject)   the course
 *     syllabus_progress   (section, unit)                   what a class did
 *
 * Grade 6 Science has **one** syllabus however many sections study it. Keying
 * the units on `section_id` instead would make twelve copies of one document,
 * free to disagree, and a head of department editing one of them — and
 * nothing would fail, which is why it is guarded here.
 *
 * The rest is the handful of things this module got wrong once, each found by
 * probing rather than by reading:
 *
 *   - **`subject_id` on the progress row.** It is what lets the write policy
 *     tell English from Science; without it a class teacher could mark any
 *     subject covered for their class.
 *   - **The refusal.** `syllabus_mark` first guarded its INSERT with a
 *     row-count assertion copied from `0254` — where the statements were
 *     UPDATEs. An INSERT refused by `WITH CHECK` *raises*, so the branch could
 *     never run and a teacher met `new row violates row-level security policy
 *     for table "syllabus_progress"`.
 *   - **`share_covered` being null rather than 0** where no syllabus exists.
 *
 * Every assertion reads a file, so this runs without a database, and each was
 * verified by planting the violation.
 */

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

/** Comments stripped: this module's prose quotes the things it forbids. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** The highest-numbered definition wins: migrations are immutable. */
function latestDefinition(name: string): string {
  const sql = code(migrationSql());
  const marker = new RegExp(`create (?:or replace )?function public\\.${name}\\(`, "g");
  const starts = [...sql.matchAll(marker)].map((m) => m.index ?? -1);
  expect(starts.length, `no migration defines public.${name}`).toBeGreaterThan(0);
  const start = starts[starts.length - 1];
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end === -1 ? undefined : end);
}

/** The live text of a policy: its last `create policy` wins. */
function latestPolicy(name: string, table: string): string {
  const sql = code(migrationSql());
  const all = [
    ...sql.matchAll(new RegExp(`create policy "${name}" on public\\.${table}[\\s\\S]*?;`, "g")),
  ].map((m) => m[0]);
  expect(all.length, `no migration creates policy "${name}" on ${table}`).toBeGreaterThan(0);
  return all[all.length - 1];
}

/** The CREATE TABLE body, so a column assertion is about the table. */
function createTable(name: string): string {
  const sql = code(migrationSql());
  const start = sql.indexOf(`create table public.${name} (`);
  expect(start, `no migration creates public.${name}`).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("\n);", start));
}

describe("a syllabus is about a course, and coverage is about a class", () => {
  it("keys the units on the class level and not on a section", () => {
    // The whole shape. A section_id here is twelve copies of one document.
    const units = createTable("syllabus_units");
    expect(units).toContain("class_level_id uuid not null");
    expect(units).toContain("subject_id uuid not null");
    expect(units, "a syllabus belongs to a course, not to one class of it")
      .not.toMatch(/\bsection_id\b/);
  });

  it("keys progress on the section, and carries the class and the subject", () => {
    const progress = createTable("syllabus_progress");
    expect(progress).toContain("section_id uuid not null");
    // Both carried columns exist, and both are what the two keys hold equal.
    expect(progress).toContain("class_level_id uuid not null");
    expect(progress).toContain("subject_id uuid not null");
  });

  it("holds the carried columns against both parents, and cascades only from the unit", () => {
    const progress = createTable("syllabus_progress");

    const unitFk = progress.slice(progress.indexOf("syllabus_progress_unit_fkey"));
    expect(unitFk.slice(0, 300)).toContain(
      "references public.syllabus_units (tenant_id, id, class_level_id, subject_id)",
    );
    // Moving a unit between class levels is a correction to a plan.
    expect(unitFk.slice(0, 300)).toContain("on update cascade");

    const sectionFk = progress.slice(progress.indexOf("syllabus_progress_section_fkey"));
    const sectionClause = sectionFk.slice(0, sectionFk.indexOf("),") + 1);
    expect(sectionClause).toContain("references public.sections (tenant_id, id, class_level_id)");
    // A section's class level changing under recorded teaching is a mistake to
    // refuse, not a rewrite to perform.
    expect(sectionClause, "the section side must not cascade").not.toContain("on update cascade");
  });

  it("stores no row for a unit nobody has touched", () => {
    // Absence is 'pending'. A third status value would be 576 rows saying
    // nothing happened, and every reader would start by filtering them out.
    const progress = createTable("syllabus_progress");
    expect(progress).toContain("check (status in ('in_progress', 'covered'))");
    expect(latestDefinition("syllabus_for_section")).toContain("coalesce(p.status, 'pending')");
  });
});

describe("who may write what", () => {
  it("gates the tenant-wide reads on academics.view, which no family holds", () => {
    // 0253's lesson: a tenant-wide policy is only as narrow as its permission,
    // and the word in the policy name is not a predicate. `academics.view` is
    // held by the administrator and the teacher and by neither parent nor
    // student — which is what makes this safe where `exams.view` was not.
    for (const table of ["syllabus_units", "syllabus_progress"]) {
      const policy = latestPolicy(`staff view ${table}`, table);
      expect(policy).toContain("role_has_permission('academics.view')");
    }
  });

  it("gives a family their own child's course by the enrolment, never by a permission", () => {
    for (const name of ["students view own syllabus_units", "parents view own children syllabus_units"]) {
      const policy = latestPolicy(name, "syllabus_units");
      expect(policy, `${name} must be row-scoped through the enrolment`)
        .toContain("public.enrolments");
      expect(policy).toContain("sec.class_level_id = syllabus_units.class_level_id");
      expect(policy, `${name} must not be a permission check`)
        .not.toContain("role_has_permission");
    }
  });

  it("gives a family no policy on progress at all", () => {
    // Deliberate: the syllabus is what a child will be taught; how far behind
    // a class has fallen is a conversation between a college and its staff.
    const sql = code(migrationSql());
    const progressPolicies = [
      ...sql.matchAll(/create policy "([^"]+)" on public\.syllabus_progress/g),
    ].map((m) => m[1]);
    expect(progressPolicies.length).toBeGreaterThan(0);
    for (const name of progressPolicies) {
      expect(name, `"${name}" reads like a family policy on progress`).not.toMatch(
        /parent|student|famil/i,
      );
    }
  });

  it("asks staff_teaches about the subject as well as the class", () => {
    // Passing only the section would let a class teacher who teaches English
    // declare a Science unit covered.
    const policy = latestPolicy("teachers record their own coverage", "syllabus_progress");
    expect(policy).toContain("public.staff_teaches(section_id, subject_id)");
    expect(policy).toContain("role_has_permission('syllabus.track')");
    // Both halves, or one of them is a gap.
    expect((policy.match(/staff_teaches\(section_id, subject_id\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });

  it("grants syllabus.track by reading the matrix, not by naming a role", () => {
    const sql = code(migrationSql());
    const grant = sql.slice(sql.indexOf("'syllabus.track', true"));
    expect(/permission_code\s*=\s*'homework\.manage'/.test(grant.slice(0, 400))).toBe(true);
  });
});

describe("the refusal a person actually sees", () => {
  it("checks authority before the INSERT, not by counting rows after it", () => {
    // 0257. An INSERT refused by WITH CHECK raises, so a row-count assertion
    // after it can never run — the caller meets Postgres's own words.
    const body = latestDefinition("syllabus_mark");
    const check = body.indexOf("staff_teaches(p_section_id, v_unit.subject_id)");
    const insert = body.indexOf("insert into public.syllabus_progress");
    expect(check, "syllabus_mark must check who is asking").toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(check, "the authority check must come BEFORE the write").toBeLessThan(insert);
  });

  it("names the subject and the class when it refuses", () => {
    const body = latestDefinition("syllabus_mark");
    expect(body).toContain("You are not down to teach % to %");
    expect(body).toContain("errcode = '42501'");
  });

  it("does not raise when there was nothing to unmark", () => {
    // Removing a unit that was never marked is the state the caller wanted.
    const body = latestDefinition("syllabus_unmark");
    expect(body).toContain("'removed', v_n");
    expect(body, "unmarking something absent is not an error").not.toContain("raise exception");
  });
});

describe("the pace tells the truth about a year that has ended", () => {
  const body = latestDefinition("syllabus_pace");

  it("reports null rather than zero where no syllabus exists", () => {
    // "Grade 4 Hindi: 0%" is an accusation against a teacher who is teaching
    // perfectly well. Three states, not a nullable number.
    expect(body).toMatch(/case when coalesce\(pl\.n_periods, 0\) = 0 then null/);
  });

  it("carries a year_state rather than an elapsed fraction over 100%", () => {
    // This college's current session ended on 31 Mar 2026 and it is now
    // September. A naive elapsed fraction reads 173%.
    expect(body).toContain("'before'");
    expect(body).toContain("'during'");
    expect(body).toContain("'ended'");
    expect(body).toContain("current_date > v_sess.end_date");
  });

  it("counts teaching days, and counts them once", () => {
    // `hr_working_days` walks the calendar asking `academics_is_teaching_day`.
    // Called inside the projection it would run once per course.
    expect(body).toContain("public.hr_working_days");
    const queryStart = body.indexOf("return query");
    const calls = [...body.matchAll(/public\.hr_working_days/g)].map((m) => m.index ?? -1);
    expect(calls.length).toBeGreaterThan(0);
    for (const at of calls) {
      expect(at, "hr_working_days must be computed before the query, not per row")
        .toBeLessThan(queryStart);
    }
  });

  it("drives off the courses a class studies, so an untracked one is still a row", () => {
    // Driven off the syllabus instead, a course with no syllabus would be
    // absent rather than reported — which is the thing worth knowing.
    expect(body).toContain("public.section_subjects");
    expect(body).toMatch(/left join planned/);
  });
});

describe("the critic", () => {
  const body = latestDefinition("syllabus_problems");

  it("refuses a caller who could not act on the answer", () => {
    expect(body).toContain("role_has_permission('academics.manage')");
    expect(body).toContain("raise exception");
  });

  it("is silent until the college has written at least one syllabus", () => {
    // A new college greeted with 48 findings about a module it has not opened
    // learns to ignore the check page.
    const early = body.slice(0, body.indexOf("v_no_syllabus > 0"));
    expect(early).toMatch(/if v_any = 0 then\s+return;/);
  });

  it("reads its threshold from the settings catalogue", () => {
    // What "behind" means is a college's decision, not a constant.
    expect(body).toContain("setting_value('academics.syllabus')");
    expect(body).toContain("behind_by");
    const sql = code(migrationSql());
    expect(sql).toContain("'academics.syllabus',");
  });
});

describe("reordering", () => {
  it("keeps the position constraint deferrable and defers it", () => {
    // Renumbering 1..n in one statement collides at every intermediate state.
    const units = createTable("syllabus_units");
    expect(units).toContain("deferrable initially immediate");
    const body = latestDefinition("syllabus_reorder");
    expect(body).toContain("set constraints public.syllabus_units_one_per_position deferred");
  });

  it("refuses to reorder across two courses at once", () => {
    // "Position 3" would otherwise mean three different things in one write.
    expect(latestDefinition("syllabus_reorder")).toContain("v_courses > 1");
  });
});
