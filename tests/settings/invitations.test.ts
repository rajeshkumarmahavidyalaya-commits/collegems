import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_SUBJECTS, SUBJECT_PROMPT } from "@/lib/validations/platform";

/**
 * An invitation that can name a person.
 *
 * `invitations` has carried `guardian_id`, `student_id` and `staff_id` since
 * migration `0004`, and `handle_new_auth_user` has resolved all four onto
 * `user_profiles` for just as long. The invite form sent an email address and a
 * role — `guardianId` appeared in it **zero times** — so every Parent
 * invitation created a login whose `guardian_id` is null, and the policy is not
 * ambiguous about what that means:
 *
 *     parents view own children  ... up.guardian_id = gs.guardian_id
 *     students view self         ... id = up.student_id
 *     teachers view own section  ... up.staff_id = s.class_teacher_staff_id
 *
 * Null on either side and the policy matches nothing. Measured on the demo
 * college before this landed: 555 guardians, **0 guardian logins**.
 *
 * Every assertion reads a file, so this runs without a database.
 */

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const TEAM = join(ROOT, "src/app/(app)/settings/team");

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

/** Comments stripped — a guard that reads prose reports on the prose. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

describe("the subject is asked for, and the database is the gate", () => {
  it("constrains a pending invitation to name the record its role stands for", () => {
    const sql = code(migrationSql());
    expect(sql).toContain("invitations_subject_present");
    // All four kinds accounted for: a rule that forgot one would let exactly
    // the defect this closes back in for that kind alone.
    for (const kind of ROLE_SUBJECTS.filter((s) => s !== "none")) {
      expect(sql, `the CHECK says nothing about ${kind}`).toMatch(
        new RegExp(`when '${kind}' then`),
      );
    }
  });

  it("carries the role's subject by a key, not by trusting the caller", () => {
    const sql = code(migrationSql());
    expect(sql).toMatch(/foreign key \(tenant_id, role_id, role_subject\)/i);
    expect(sql).toMatch(/references public\.roles \(tenant_id, id, subject\)/i);
  });

  it("fills the carried column with a trigger, because a plain insert has no function to run", () => {
    // `0224` shipped the key without a writer and refused a correct insert.
    // The trigger populates; the key and the CHECK enforce.
    const sql = code(migrationSql());
    expect(sql).toContain("invitation_carry_role_subject");
    expect(sql).toMatch(/before insert or update on public\.invitations/i);
    // ...and no caller sends it, which is the whole point of the trigger.
    const actions = code(readFileSync(join(TEAM, "actions.ts"), "utf8"));
    expect(actions).not.toContain("role_subject");
  });
});

describe("the subject decides what is asked, never what is allowed", () => {
  /**
   * `roles.tier`'s warning, applied to its neighbour. A subject column beside a
   * permission matrix looks exactly like a shortcut, and would replace a
   * per-college decision with a hardcoded one.
   */
  it("never appears inside a policy", () => {
    const sql = code(migrationSql());
    for (const stmt of sql.matchAll(/create policy[\s\S]*?;/gi)) {
      // The policy's *name* is not its expression, and this codebase has a
      // `"subject teachers manage marks"` — about an academic subject. Matching
      // the whole statement reported it and would have had somebody weaken a
      // correct policy to satisfy a guard. Drop the quoted name first.
      const expression = stmt[0].replace(/"[^"]*"/, "");
      // `role_subject`, not just `subject`: `\b` finds no boundary inside a
      // word containing an underscore, so the first draft passed on a planted
      // `using (role_subject = 'guardian')` — which is precisely the shortcut
      // worth forbidding, since `invitations` is where the column is carried.
      expect(expression, "a policy is reading the role's subject").not.toMatch(
        /\b(?:role_subject|subject)\b/i,
      );
    }
  });

  it("is read from the database rather than inferred from a role's code", () => {
    // A `case role.code` in TypeScript would be this product's six roles
    // hardcoded — what `0208` already refused for the tier, and wrong for a
    // college that adds a role on a Tuesday.
    const files = ["actions.ts", "team-view.tsx", "subject-picker.tsx"].map((f) =>
      code(readFileSync(join(TEAM, f), "utf8")),
    );
    for (const body of files) {
      expect(body).not.toMatch(/code === "parent"/);
      expect(body).not.toMatch(/code === "student"/);
    }
    expect(files[0]).toContain('.select("subject, name")');
  });

  it("gates the candidate list on users.manage, not on the policy alone", () => {
    // Reading `people` is tenant-wide for every staff role, so RLS would let a
    // librarian enumerate the roll through a picker. Rule 4's `report_run`
    // refinement: the check is inside the function that produces the data.
    const sql = code(migrationSql());
    const start = sql.lastIndexOf("function public.invite_candidates(");
    const body = sql.slice(start, sql.indexOf("$$;", start));
    expect(body).toContain("role_has_permission('users.manage')");
  });
});

describe("the form", () => {
  it("sends one subject, and the server decides which column it lands in", () => {
    const actions = code(readFileSync(join(TEAM, "actions.ts"), "utf8"));
    // The client cannot put a student's id into `guardian_id`, and there is no
    // three-way "exactly one of these" rule in the browser to get wrong.
    expect(actions).toMatch(/staff_id: subject === "staff"/);
    expect(actions).toMatch(/student_id: subject === "student"/);
    expect(actions).toMatch(/guardian_id: subject === "guardian"/);
  });

  it("draws the picker only when the role stands for somebody", () => {
    const view = code(readFileSync(join(TEAM, "team-view.tsx"), "utf8"));
    expect(view).toContain("<SubjectPicker");
    expect(view).toMatch(/subject !== "none" &&/);
  });

  it("asks the question in words for every kind that has one", () => {
    for (const kind of ROLE_SUBJECTS) {
      if (kind === "none") continue;
      expect(SUBJECT_PROMPT[kind]).toMatch(/\?$/);
    }
  });

  it("keeps the prompts out of the Zod barrel", () => {
    /**
     * Measured, because this was got wrong first: importing `SUBJECT_PROMPT`
     * from `platform.ts` — which begins `import { z } from "zod"` — took
     * `/settings/team` from **149 kB to 176 kB**. After the split, **150 kB**:
     * the whole picker costs 1 kB and the other 26 were Zod.
     *
     * `fees-display.ts`'s own comment is the rule this re-learned: one
     * `import { z }` and it silently becomes the thing it was extracted from.
     */
    const display = code(
      readFileSync(join(ROOT, "src/lib/validations/invitations-display.ts"), "utf8"),
    );
    expect(display, "invitations-display.ts must have no imports").not.toMatch(/^\s*import\s/m);

    const picker = code(readFileSync(join(TEAM, "subject-picker.tsx"), "utf8"));
    expect(picker, "a client component must not import the Zod barrel").not.toContain(
      "validations/platform",
    );
  });

  it("refuses in a sentence before the CHECK has to", () => {
    // A control that will refuse you is worse than no control: without this the
    // office fills in an address, picks Parent, presses Invite and meets
    // `23514 invitations_subject_present`.
    const actions = code(readFileSync(join(TEAM, "actions.ts"), "utf8"));
    expect(actions).toContain("SUBJECT_PROMPT[subject]");
    expect(actions).toMatch(/fieldErrors: \{ subjectId:/);
  });
});
