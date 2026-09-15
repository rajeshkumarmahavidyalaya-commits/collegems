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

/**
 * The **body** of a function's latest definition.
 *
 * Anchored on `create or replace function`, not on the last mention of the
 * name: `comment on function public.invitation_announce(uuid, text)` contains
 * the name too and comes *after* the body, so a `lastIndexOf` of the bare name
 * returns the comment and a slice of it contains nothing. CLAUDE.md records
 * exactly this bug from the `0219` guard — and it was written again here, which
 * is why it is a helper now rather than an inline `indexOf`.
 */
function functionBody(name: string): string {
  const sql = code(migrationSql());
  const marker = `create or replace function public.${name}(`;
  const start = sql.lastIndexOf(marker);
  expect(start, `no migration defines public.${name}`).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end === -1 ? undefined : end);
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

describe("somebody is told they were invited", () => {
  /**
   * Swept before building it: **nothing sent an invitation.** The row existed,
   * `handle_new_auth_user` resolved it on signup, and the only mentions of the
   * word elsewhere in `src/` were interface copy telling a person to *ask*
   * their administrator for one.
   */
  it("addresses an address, not a user", () => {
    /**
     * `notify_resolve_audience` returns `TABLE(user_id uuid)` and every branch
     * reads `user_profiles`. An invitee is, by definition, not one — so this
     * must not be a new `kind` there. `notification_deliveries.recipient_user_id`
     * is nullable and `address` sits beside it; `notify_claim_deliveries` never
     * joins `user_profiles`; and `notify-dispatch` reads `delivery.address`.
     */
    const body = functionBody("invitation_announce");
    expect(body).toContain("insert into public.notification_deliveries");
    expect(body, "the delivery must carry no recipient user").toMatch(/recipient_user_id/);
    expect(body).toContain("role_has_permission('users.manage')");
    // Definer, because notification_deliveries has no INSERT policy at all —
    // which is what stops a student inventing a message from the principal.
    expect(body).toMatch(/security definer/i);
  });

  it("declares the event, and does not queue an in-app message to somebody with no account", () => {
    // Read the one migration that declares it. Matching across every migration
    // concatenated let a non-greedy `[\s\S]*?;` run from an *earlier* file's
    // insert all the way to this one, swallowing unrelated text — and the
    // `in_app` assertion then failed on somebody else's CHECK constraint.
    const file = readdirSync(MIGRATIONS).find((f) => f.includes("nobody_is_told"));
    expect(file, "the migration that declares invitation.sent was renamed").toBeTruthy();
    const sql = code(readFileSync(join(MIGRATIONS, file!), "utf8"));
    const row = sql.match(/insert into reference\.notification_types[\s\S]*?;/);
    expect(row, "invitation.sent is not in the catalogue").not.toBe(null);
    expect(row![0]).toContain("array['email']");
    expect(row![0], "an in-app message needs an account to open it").not.toContain("in_app");
    // Rule 10's per-kind staleness: a week-old invitation email is not worth
    // sending when a channel is switched on.
    expect(row![0]).toContain("7 days");
  });

  it("refuses a link it cannot vouch for", () => {
    // Postgres does not know this deployment's address, so it is a parameter —
    // and a parameter pasted into an email unread is how `undefined/signup`
    // reaches four hundred families.
    const body = functionBody("invitation_announce");
    expect(body).toMatch(/\^https\?:\/\//);

    const actions = code(readFileSync(join(TEAM, "actions.ts"), "utf8"));
    expect(actions, "the origin comes from the request, not a constant").toContain(
      "x-forwarded-host",
    );
    expect(actions, "guessing a URL is worse than declining to send").toMatch(
      /if \(!url\) \{/,
    );
  });

  it("does not let a failed announcement fail the invitation", () => {
    // The notice board's rule, at the invitation screen: the row is the
    // mechanism and the message is the courtesy. The reason travels back with
    // the success rather than being thrown or swallowed.
    const actions = code(readFileSync(join(TEAM, "actions.ts"), "utf8"));
    expect(actions).toMatch(/announced: announced\.ok \? announced\.data : \[\]/);
    expect(actions).toMatch(/announceError: announced\.ok \? null : announced\.error/);
    const view = code(readFileSync(join(TEAM, "team-view.tsx"), "utf8"));
    expect(view, "the screen must say what went out").toMatch(/describeAnnouncement\(/);
    expect(view).toMatch(/toast\.warning/);
  });

  /**
   * An SMS is not an email with fewer lines — migration `0233`.
   *
   * The email body is a letter: measured, **346 characters, and UCS-2 because
   * of its two em dashes, which is 6 SMS segments.** Sent as-is to 555 families
   * that is 3,330 billable parts to say something that fits in one. So the
   * raiser composes two bodies, and the short one measured **137–147 GSM-7
   * characters over all 555 of this college's guardians — 555 of 555 in one
   * segment.**
   */
  it("writes a second body rather than sending the letter by SMS", () => {
    const body = functionBody("invitation_announce");

    // Two bodies, and the SMS one is the one chosen for the SMS channel.
    expect(body).toMatch(/v_short\s+text;/);
    expect(body).toMatch(/case when c\.ch = 'sms' then v_short else v_long end/);

    // The short body may not contain the characters that force UCS-2. The
    // long one is an email and keeps its em dashes — that is the difference.
    const short = body.slice(body.indexOf("v_short := format("));
    const shortLiteral = short.slice(0, short.indexOf(";"));
    for (const ch of ["\u2014", "\u2013", "\u2018", "\u2019", "\u201c", "\u201d", "\u20b9"]) {
      expect(
        shortLiteral.includes(ch),
        `a character outside GSM-7 halves the segment: ${JSON.stringify(ch)}`,
      ).toBe(false);
    }

    // ...and it still carries the one fact that cannot be dropped. Signing up
    // with a different address silently creates a tenantless login.
    expect(shortLiteral).toContain("v_inv.email");
  });

  it("reads the channel list from the catalogue rather than a literal", () => {
    // `0227` wrote array['email'] into reference.notification_types and then
    // hardcoded 'email' underneath, so the catalogue row was decoration: a
    // school editing it would have changed nothing, silently.
    const body = functionBody("invitation_announce");
    expect(body).toMatch(/select nt\.default_channels into v_channels/);
    expect(body).toMatch(/unnest\(v_channels\)/);
  });

  it("does not price a message it did not send", () => {
    // Migration `0234`. A skipped delivery keeps its body so somebody can see
    // what would have gone; it does not keep a price. Null and not zero, for
    // the reason a collection rate is null before anything is billed.
    const body = functionBody("invitation_announce");
    expect(body).toMatch(/w\.channel = 'sms' and w\.status = 'queued'/);
  });

  it("offers Send again only where it will work", () => {
    // `invitation_announce` refuses an accepted or withdrawn invitation, and a
    // button that will refuse you is the same defect one click along.
    const view = code(readFileSync(join(TEAM, "team-view.tsx"), "utf8"));
    const pendingBlock = view.slice(view.indexOf('inv.status === "pending"'));
    expect(pendingBlock).toContain("onAnnounce(inv.id");
  });
});

describe("inviting a school rather than a person", () => {
  const BULK = join(TEAM, "bulk");

  it("applies through the module's own write function, not an insert", () => {
    /**
     * Rule 13's sentence from renewals: *a renewal that inserted rows would be
     * a second implementation of five checks.* Here the rule that would be
     * duplicated is the supersede — a second pending invitation to one address
     * is the same intent expressed twice — plus the subject-to-column mapping.
     * `invitation_create` is the one definition and both callers use it.
     */
    const body = functionBody("invitation_apply");
    expect(body).toContain("public.invitation_create(");
    expect(body, "the apply must not write invitations itself").not.toMatch(
      /insert into public\.invitations/,
    );
  });

  it("records that a person overrode the rules", () => {
    // is_override is the difference between "the rules decided" and "the head
    // teacher decided", and both belong in the audit log.
    const actions = code(readFileSync(join(BULK, "actions.ts"), "utf8"));
    expect(actions).toMatch(/is_override: true/);
  });

  it("refuses an oversized list rather than truncating it", () => {
    // Silently holding the first thousand of fourteen hundred looks complete,
    // and the families left off are discovered by their absence in April.
    const body = functionBody("invitation_preview");
    expect(body).toMatch(/v_count > v_max/);
    expect(body).toContain("delete from public.invitation_runs");
    expect(body, "the refusal must carry the numbers").toMatch(/capped at %/);
  });

  it("keeps one live list at a time, and says so in words", () => {
    const sql = code(migrationSql());
    expect(sql).toMatch(/create unique index if not exists invitation_runs_one_live/);
    // The index alone would refuse with 23505, which is not a sentence.
    expect(functionBody("invitation_preview")).toContain("There is already an invitation list waiting");
  });

  it("is one row per address, not per person and not per child", () => {
    /**
     * Two `distinct on`s and both are load-bearing: a mother of three is one
     * invitation, and two parents who give the school one address are one row
     * — otherwise the second collides with the unique index and takes the
     * whole preview down with a 23505. Probed live by planting a shared
     * address: 555 guardians became 554 rows.
     */
    const body = functionBody("invitation_preview");
    // **Once per branch**, not once anywhere. The first draft asserted the
    // pattern appeared at all, and passed on a plant that removed it from the
    // guardian branch — the two other branches still had it. A guard that
    // checks for a string rather than for the mechanism guards the string.
    const deduped = [...body.matchAll(/distinct on \(coalesce\(lower\(c0\.email\)/g)];
    expect(deduped.length, "each of guardian, student and staff must dedupe by address").toBe(3);
    const sql = code(migrationSql());
    expect(sql).toContain("invitation_decisions_one_per_address");
  });

  it("says whether the emails went, not only that people were invited", () => {
    // A failed announcement is not a failed invitation, so apply returns three
    // counts and the screen reads all three.
    const body = functionBody("invitation_apply");
    // The counter being *declared* and *returned* proves nothing; the claim is
    // that it is incremented only when an announcement succeeded.
    expect(body).toMatch(/v_emailed := v_emailed \+ 1;/);
    expect(body).toMatch(/perform public\.invitation_announce\([\s\S]{0,120}v_emailed := v_emailed \+ 1;/);
    const view = code(readFileSync(join(BULK, "bulk-invite-view.tsx"), "utf8"));
    // `[\s\S]*` rather than `/s`: tsconfig targets ES2017 and the dotAll flag
    // is ES2018, so the flag compiles under vitest's esbuild and fails
    // `tsc --noEmit` — green in the runner, red in CI's typecheck.
    expect(view).toMatch(/invited[\s\S]*emailed/);
    expect(view).toMatch(/toast\.warning/);
  });
});
