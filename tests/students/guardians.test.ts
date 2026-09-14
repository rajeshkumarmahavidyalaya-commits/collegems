import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUARDIAN_RELATIONSHIPS,
  normaliseRelationship,
  relationshipLabel,
} from "@/lib/validations/guardians";
import { en } from "@/lib/i18n/messages/en";
import { createTranslator } from "@/lib/i18n/translate";

/**
 * The guardian write path, guarded by reading the source.
 *
 * `guardian_student` decides which family sees which child, and until migration
 * `0221` **nothing in this application could create a row in it** — the 555
 * links on the demo college came from the seed, and the bulk import collected a
 * guardian's name and telephone number, refused a row that lacked the number,
 * and dropped both.
 *
 * Every assertion here reads a file, so the suite runs without a database. The
 * DB-backed suites cannot run in every environment, and *a check that can never
 * go green is a check people learn to ignore.*
 */

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");

function migrations(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), "utf8") }));
}

/**
 * The **latest** definition of a function, not every definition of it.
 *
 * Migrations are immutable and `create or replace` is how a function changes,
 * so *"what does this do"* is always a question about the highest-numbered file
 * that defines it. `guardian_link` is defined in `0221` and again in `0222`; a
 * sweep over both answers by filename accident. Same rule
 * `tests/schema/a-reason-is-kept.test.ts` had to learn about `student_exit`.
 */
function latestDefinition(name: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;

  for (const { file, sql } of migrations()) {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    if (start === -1) continue;
    // A plpgsql/sql body ends at the `$$;` that closes it.
    const end = sql.indexOf("$$;", start);
    found = { file, body: sql.slice(start, end === -1 ? undefined : end + 3) };
  }

  if (!found) throw new Error(`No migration defines public.${name}`);
  return found;
}

/**
 * Comments stripped, so a guard reads the schema rather than the prose.
 *
 * The third time this file's lesson has been paid for: the operator-boundary
 * guard passed on a **commented-out** revoke, the Server-Component guard failed
 * on a comment *explaining* that `useI18n` must not be used — and the
 * `.or(` assertion below first failed on the doc comment that explains why
 * `.or(` was replaced. A comment can hide a violation **and** fake one, and a
 * SQL guard reading TypeScript needs the other comment syntax too.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

function sourceFiles(dir: string, exts: string[], acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      sourceFiles(p, exts, acc);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      acc.push(p);
    }
  }
  return acc;
}

describe("the relationship list has one owner", () => {
  /**
   * A `<Select>` cannot ask a CHECK what to draw, so there are two copies of
   * this list and only one of them is load-bearing. This is what keeps the
   * second one honest — without it, `GUARDIAN_RELATIONSHIPS` is
   * `library.fine_per_day`'s sixth reader.
   */
  it("matches the CHECK on guardian_student.relationship", () => {
    const sql = migrations()
      .map((m) => m.sql)
      .join("\n");
    const check = sql.match(
      /relationship\s+text\s+not\s+null\s+check\s*\(\s*relationship\s+in\s*\(([^)]*)\)/i,
    );
    expect(check, "the CHECK that owns this list was not found — has it been reshaped?").not.toBe(
      null,
    );

    const fromConstraint = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(fromConstraint).toEqual(GUARDIAN_RELATIONSHIPS.map((r) => r.value));
  });

  it("names every value in the source catalogue", () => {
    // English is the source catalogue, so a missing key here is a label helper
    // falling back silently for every reader in every language.
    for (const { value } of GUARDIAN_RELATIONSHIPS) {
      expect(Object.keys(en)).toContain(`guardians.relationship.${value}`);
    }
  });

  it("falls back to the value, never to the key", () => {
    const t = createTranslator("en");
    expect(relationshipLabel("mother", t)).toBe("Mother");
    // A row written before a value existed reads as itself rather than as
    // `guardians.relationship.grandmother`.
    expect(relationshipLabel("grandmother", t)).toBe("grandmother");
  });
});

describe("normaliseRelationship", () => {
  it("treats case as typing, not as meaning", () => {
    expect(normaliseRelationship("Mother")).toBe("mother");
    expect(normaliseRelationship("  FATHER ")).toBe("father");
  });

  it("does not guess at a word outside the list", () => {
    // Filing a grandmother as `guardian` is a decision, and it belongs to the
    // person holding the spreadsheet. Migration `0222` names it in the preview.
    expect(normaliseRelationship("Grandmother")).toBe("grandmother");
  });

  it("is null for nothing at all", () => {
    expect(normaliseRelationship("")).toBe(null);
    expect(normaliseRelationship(null)).toBe(null);
    expect(normaliseRelationship(undefined)).toBe(null);
  });
});

describe("the write function is the only way in", () => {
  /**
   * Rule 6's sentence about billing, applied to people: *one definition,
   * consulted by everything.* A plain insert through PostgREST routes around
   * any function (migration `0205`'s lesson), so a second writer here would be
   * a second answer to "what is a guardian" — and the importer already had one
   * of those, which is how it came to collect a mother's name and drop it.
   */
  it("has no INSERT into guardian_student anywhere in src/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "src"), [".ts", ".tsx"])) {
      const body = readFileSync(file, "utf8");
      // The generated types name every table; only a write is a violation.
      if (/\.from\(\s*["'](guardian_student|guardians)["']\s*\)[\s\S]{0,200}?\.(insert|upsert|update|delete)\(/.test(body)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders, "write guardians through guardian_add / guardian_link").toEqual([]);
  });

  it("takes its labels as props rather than the catalogue as a dependency", () => {
    /**
     * The i18n catalogue is one 57 kB chunk pulled into any route that calls
     * `useI18n()` on the client, and `/students/[id]` had no client code at all
     * before this card. Measured across three builds of the same page: **167 kB**
     * as a pure Server Component, **217 kB** with the hook in the card, **170 kB**
     * with the names resolved by `await getT()` and passed in.
     *
     * The `PhotoControl` bargain from the ID-card batch, and the reason the rule
     * is worth a guard rather than a comment: adding `useI18n()` back would
     * compile, pass every other check, and cost the route 47 kB silently.
     */
    for (const file of ["guardians-card.tsx", "guardian-dialogs.tsx"]) {
      const body = code(readFileSync(join(ROOT, "src/app/(app)/students/[id]", file), "utf8"));
      expect(body, `${file} should take its labels as props`).not.toContain("useI18n");
    }
  });

  it("builds no filter string out of the search term", () => {
    /**
     * `.or("first_name.ilike.%" + term + "%")` is a filter language with
     * somebody's typing spliced into it, so a guardian searched for as
     * `O'Brien, R` closes the group early. `guardian_search` (migration `0223`)
     * takes it as a bound parameter.
     */
    const actions = readFileSync(join(ROOT, "src/app/(app)/students/guardian-actions.ts"), "utf8");
    expect(actions).toContain('supabase.rpc("guardian_search"');
    // Only the doc comment may mention the shape it replaced.
    expect(code(actions)).not.toMatch(/\.or\(/);
  });
});

describe("the database says what it will accept", () => {
  it("lower-cases the relationship rather than refusing a capital letter", () => {
    const { body } = latestDefinition("guardian_link");
    expect(code(body)).toMatch(/lower\(btrim\(coalesce\(p_relationship/);
  });

  it("answers a check violation with words", () => {
    /**
     * A control that will refuse you is worse than no control. Before `0222`
     * the importer's own error column read *"new row for relation
     * \"guardian_student\" violates check constraint
     * \"guardian_student_relationship_check\""* — measured, on a row whose only
     * fault was saying `Grandmother`.
     */
    const { body } = latestDefinition("guardian_link");
    const stripped = code(body);
    expect(stripped).toMatch(/exception\s+when\s+check_violation\s+then/);
    expect(stripped).toContain("public.allowed_values('public.guardian_student', 'relationship')");
  });

  it("names the problem in the preview, not after the child is imported", () => {
    // Rule 13: a bulk operation's preview is editable rows. A run that reports
    // "2 of 2 ready" and then half-applies one of them is not a preview.
    const { body } = latestDefinition("import_validate_run");
    expect(code(body)).toContain("is not a relationship this product records");
  });

  it("keeps the guardian when the import loses one", () => {
    /**
     * The admission is the thing being imported, so a guardian that fails to
     * save must not lose the child — rule 13's *"apply partially and record
     * why"*. The sub-block is what makes the row re-runnable for the guardian
     * alone.
     */
    const { body } = latestDefinition("import_apply_run");
    expect(code(body)).toContain("public.guardian_add(");
    expect(code(body)).toContain("Student imported; the guardian could not be added");
  });

  it("never deletes the guardian when a link is removed", () => {
    // They may have other children here, and a person who is nobody's guardian
    // any more is still the person who paid last year's fees.
    const { body } = latestDefinition("guardian_unlink");
    const deletes = [...code(body).matchAll(/delete\s+from\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect(deletes).toEqual(["guardian_student"]);
  });
});
