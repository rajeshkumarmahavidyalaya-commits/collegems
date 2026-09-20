import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A certificate about somebody the college employs.
 *
 * `certificates.student_id` was `not null` for a hundred and thirteen
 * migrations, so the whole frozen-document engine — the gapless serial,
 * *preview computes; issue freezes*, the column grant that stops anybody
 * rewriting what a certificate says, the PDF renderer — was structurally
 * student-only. A lecturer leaving a college got nothing.
 *
 * What has to be guarded is not that staff certificates exist. It is the two
 * things that would be wrong invisibly:
 *
 *   - **the policy**, because `staff view certificates` was tenant-wide and
 *     would have handed every teacher their colleagues' experience
 *     certificates the day this shipped;
 *   - **the pairing**, because a template written about employment filled with
 *     a student's snapshot renders blanks and still issues.
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

/** Comments stripped, both syntaxes — a guard that reads prose reports on it. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").replace(/^\s*\/\/.*$/, ""))
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

describe("a colleague's certificate is not staff-room reading", () => {
  const sql = code(migrationSql());

  /**
   * The policy that would have leaked. `staff view certificates` compared the
   * role code against four of them and nothing else — tenant-wide, no row
   * ownership. Defensible for a child's bonafide certificate; wrong the instant
   * an experience certificate exists, because that one says why somebody left.
   *
   * This codebase learned the same lesson on this table's neighbour: `0009`'s
   * *"staff directory is not sensitive HR data"* was a claim about three
   * columns made by a policy that grants whole rows.
   */
  it("narrows the tenant-wide read to students", () => {
    // The old, unnarrowed policy must be gone.
    expect(sql).toMatch(/drop policy if exists "staff view certificates" on public\.certificates/);

    const narrowed = sql.slice(sql.lastIndexOf('create policy "staff view student certificates"'));
    const body = narrowed.slice(0, narrowed.indexOf(";"));
    expect(body, "the four staff roles must only reach student certificates").toMatch(
      /subject = 'student'/,
    );
  });

  /** An administrator, and the person it is about. Nobody else on the payroll. */
  it("gives a staff certificate row ownership instead", () => {
    const own = sql.slice(sql.lastIndexOf('create policy "staff view their own certificates"'));
    const body = own.slice(0, own.indexOf(";"));
    expect(body).toMatch(/subject = 'staff'/);
    expect(body).toMatch(/up\.staff_id/);
    expect(body).toContain("auth.uid()");

    const admin = sql.slice(sql.lastIndexOf('create policy "admins view staff certificates"'));
    expect(admin.slice(0, admin.indexOf(";"))).toMatch(/subject = 'staff'/);
  });

  /**
   * And the family policies need no change *because* they filter on
   * `student_id`, which is null on a staff certificate — `null in (...)` is
   * null, not true. Asserting it here so that a later migration rewriting them
   * to `coalesce(...)` or `exists` has to think about this again.
   */
  it("leaves the family policies keyed on the student id", () => {
    for (const name of [
      "guardians view their children's certificates",
      "students view their own certificates",
    ]) {
      const at = sql.lastIndexOf(`create policy "${name}"`);
      expect(at, `${name} is missing`).toBeGreaterThan(-1);
      expect(sql.slice(at, sql.indexOf(";", at))).toContain("student_id");
    }
  });
});

describe("a template and its subject cannot come apart", () => {
  const sql = code(migrationSql());

  /**
   * Rule 4's carried column. The trigger populates from the template; the
   * composite key holds the two equal; the CHECK makes the key unsatisfiable
   * unless the matching id is the one filled in. Drop any one of the three and
   * a staff template can be issued against a child.
   */
  it("carries the subject, keyed to the template", () => {
    expect(sql).toMatch(
      /add constraint certificates_template_subject_fkey[\s\S]{0,200}references public\.certificate_templates \(tenant_id, id, subject\)/,
    );
    expect(sql).toMatch(
      /add constraint certificate_templates_subject_key unique \(tenant_id, id, subject\)/,
    );
  });

  /**
   * **No cascade, and that is the opposite of every other use of this device
   * here.** Rule 4's second boundary: a certificate is a record of a day, not a
   * child kept in step with its parent. Cascading a template's subject would
   * rewrite documents already handed over.
   */
  it("does not cascade a template's subject onto issued certificates", () => {
    const at = sql.indexOf("add constraint certificates_template_subject_fkey");
    const clause = sql.slice(at, sql.indexOf(";", at));
    expect(clause, "an issued certificate must not be rewritten").not.toMatch(/on update cascade/);
  });

  it("makes exactly one subject id legal, and it is the one named", () => {
    const at = sql.indexOf("add constraint certificates_one_subject");
    expect(at, "the pairing CHECK is missing").toBeGreaterThan(-1);
    const clause = sql.slice(at, sql.indexOf(";", at));
    expect(clause).toMatch(/subject = 'student' and student_id is not null and staff_id is null/);
    expect(clause).toMatch(/subject = 'staff' and staff_id is not null and student_id is null/);
  });

  /** `0225`'s split: the trigger populates, the constraint enforces. */
  it("stamps the subject where a plain insert meets it", () => {
    expect(sql).toMatch(
      /create trigger certificates_stamp_subject\s+before insert on public\.certificates/,
    );
    expect(latestDefinition("certificates_stamp_subject")).toContain("certificate_templates");
  });
});

describe("the engine fills a template from the right person", () => {
  /**
   * **One field, not three.** The caller sends a single id and the *server*
   * reads the template to decide which snapshot fills it and which column it
   * lands in — `0224`'s invitation lesson. A client that chose would be a
   * client that could choose wrong.
   */
  it("dispatches on the template, never on a parameter", () => {
    for (const name of ["certificate_preview", "certificate_issue"]) {
      const body = latestDefinition(name);
      expect(body, `${name} must take one subject id`).toContain("p_subject_id");
      expect(body, `${name} must not be told which kind`).not.toMatch(/p_subject_kind|p_is_staff/);
      expect(body).toMatch(/if v_t\.subject = 'staff' then/);
      expect(body).toContain("certificate_staff_snapshot");
    }
  });

  /**
   * The transfer side-effect reaches into `students`. Gated on the subject as
   * well as the kind, because `kind` alone does not stop a staff template
   * called `transfer` marking a child as having left.
   */
  it("only marks a student transferred for a student template", () => {
    const body = latestDefinition("certificate_issue");
    const at = body.indexOf("update public.students set status = 'transferred'");
    expect(at, "the transfer side-effect is missing").toBeGreaterThan(-1);
    const guard = body.slice(body.lastIndexOf("if ", at), at);
    expect(guard).toContain("v_t.subject = 'student'");
  });

  /** One register, one counter: a college's certificates are numbered together. */
  it("takes both kinds of certificate from one gapless counter", () => {
    const body = latestDefinition("certificate_issue");
    expect((body.match(/fees_next_document_number_for/g) ?? []).length).toBe(1);
  });

  /**
   * Merging the two key lists is the quiet failure: a student template printing
   * `{{staff.designation}}` renders **empty**, leaves no placeholder standing,
   * and therefore issues — a sentence with a hole in it.
   */
  it("keeps the critic's known keys apart by subject", () => {
    const body = latestDefinition("certificate_template_problems");
    expect(body).toMatch(/if v_t\.subject = 'staff' then/);
    const staffBranch = body.slice(body.indexOf("if v_t.subject = 'staff' then"));
    const elseAt = staffBranch.indexOf("else");
    expect(staffBranch.slice(0, elseAt)).not.toContain("'student.name'");
    expect(staffBranch.slice(elseAt)).not.toContain("'staff.name'");
  });
});

describe("the seeded wording", () => {
  const sql = code(migrationSql());

  /**
   * Rule 12: a seeded default may only print values the database is guaranteed
   * to have. Only four `staff` columns are `not null`, and `department` is not
   * one of them — a shipped template printing it would be un-issuable for
   * anybody without a department, which is the `{{school.city}}` mistake
   * `0136` already had to undo once.
   */
  it("prints only columns that cannot be null", () => {
    const seeds = sql.slice(sql.indexOf("'Service Certificate'"));
    for (const nullable of ["staff.department", "service.reason", "staff.blood_group"]) {
      expect(seeds, `a seeded template must not print {{${nullable}}}`).not.toContain(
        `{{${nullable}}}`,
      );
    }
  });

  /**
   * …and the one exception proves the rule: the experience certificate prints
   * `{{service.to}}`, which **is** null while somebody is employed. That is
   * deliberate — it is what makes the document refuse itself for a person still
   * in post, and the service certificate is the one for them.
   */
  it("uses the nullable leaving date to separate the two", () => {
    const experience = sql.slice(sql.indexOf("'Experience Certificate'"));
    const service = sql.slice(
      sql.indexOf("'Service Certificate'"),
      sql.indexOf("'Experience Certificate'"),
    );
    expect(experience.slice(0, 1200)).toContain("{{service.to}}");
    expect(service, "a serving member of staff has no leaving date").not.toContain("{{service.to}}");
  });
});
