import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * An event nothing raises is a catalogue entry, not a feature.
 *
 * `reference.notification_types` declared nine events. Four had a raiser —
 * `attendance.absent`, `fees.due_reminder` and `library.book_overdue` through
 * `schedule_run`, and `notice.published` from the board. The other five were
 * written down and never sent, and three of them are what a family waits for:
 * a bill, a receipt, and results.
 *
 * The reason was not neglect, which is why this guard reads the *audience*
 * rather than counting callers: `notify_resolve_audience` understood `all`,
 * `role`, `users` and `section`, and **none of them could say "this child's
 * family"**. A receipt is addressed to one family, so it could not be
 * expressed, so it was never raised.
 *
 * This is the `NOT_YET_A_CONTROL` shape from
 * `tests/auth/permission-catalogue.test.ts`, applied to rule 10's catalogue —
 * and like that one it reads the source, so it runs without a database.
 */

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");

function migrations(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), "utf8") }));
}

function appFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      appFiles(p, acc);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      acc.push(p);
    }
  }
  return acc;
}

function withoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

/** Every event key the catalogue declares, parsed rather than listed here. */
function declaredEvents(): string[] {
  const found = new Set<string>();
  for (const { sql } of migrations()) {
    for (const stmt of withoutComments(sql).matchAll(
      /insert\s+into\s+reference\.notification_types[\s\S]*?;/gi,
    )) {
      for (const tuple of stmt[0].matchAll(/\(\s*'([a-z_]+\.[a-z_]+)'\s*,/gi)) {
        found.add(tuple[1]);
      }
    }
  }
  return [...found];
}

/**
 * Events deliberately declared with nothing to raise them, each with a reason.
 *
 * The bar is **the feature is unbuilt** — never "we have not got round to the
 * caller". An event whose module exists and does not raise it is the defect
 * this file was written for.
 */
const NO_RAISER_ON_PURPOSE: Record<string, string> = {
  "message.received":
    "There is no messaging feature. No table, no screen, no policy — the event " +
    "describes a module that does not exist, and the row is a placeholder for " +
    "the day somebody builds one.",
};

describe("every declared notification event has something that raises it", () => {
  it("finds the catalogue at all", () => {
    // The sanity check first: a rename that empties this makes every assertion
    // below pass on nothing.
    const events = declaredEvents();
    expect(events.length).toBeGreaterThanOrEqual(9);
    expect(events).toContain("fees.payment_received");
    expect(events).toContain("attendance.absent");
  });

  it("has no event that nothing sends", () => {
    // A raiser is anything that passes the key to notify_send / notify_send_for.
    // The declaration itself does not count — a row that only names itself is
    // exactly what is being looked for.
    //
    // **And a raiser is not always SQL.** The first draft read only the
    // migrations and reported `general.announcement` as an orphan; it is raised
    // by the compose screen, in TypeScript, which is the one event a person
    // types the words for. A guard that had been trusted would have had that
    // event deleted or excused, either of which is worse than the bug.
    const bodies = [
      ...migrations().map(({ sql }) =>
        withoutComments(sql).replace(
          /insert\s+into\s+reference\.notification_types[\s\S]*?;/gi,
          "",
        ),
      ),
      ...appFiles(join(ROOT, "src")).map((f) => readFileSync(f, "utf8")),
    ];

    const orphans: string[] = [];

    for (const key of declaredEvents()) {
      if (key in NO_RAISER_ON_PURPOSE) continue;
      const raised = bodies.some(
        (body) => body.includes(`'${key}'`) || body.includes(`"${key}"`),
      );
      if (!raised) orphans.push(key);
    }

    expect(
      orphans,
      "An event a school can see in the delivery log must have something that " +
        "raises it. One that nothing sends is a promise in a catalogue. Wire it " +
        "up, or name it in NO_RAISER_ON_PURPOSE with the reason its module is " +
        "unbuilt.",
    ).toEqual([]);
  });

  it("keeps the audience kind that made per-child events expressible", () => {
    // The whole finding in one assertion. Remove `students` and a receipt has
    // no way to name its recipient again — and the three raisers above would
    // fail at run time rather than at compile time, on a screen where somebody
    // is holding cash.
    const all = migrations()
      .map(({ sql }) => withoutComments(sql))
      .join("\n");

    // `lastIndexOf("function public.notify_resolve_audience")` finds the
    // `comment on function` statement, which sits *after* the body — so the
    // slice contained the comment and nothing else, and the first draft failed
    // on the `all` audience that has been there since 0035. Anchor on the
    // definition.
    const resolver = all.lastIndexOf(
      "create or replace function public.notify_resolve_audience",
    );
    expect(resolver, "notify_resolve_audience should still exist").toBeGreaterThan(-1);

    const body = all.slice(resolver);
    for (const kind of ["all", "role", "users", "section", "students"]) {
      expect(body, `notify_resolve_audience must still understand the '${kind}' audience`).toContain(
        `= '${kind}'`,
      );
    }
  });

  it("keeps a raiser out of the caller's hands", () => {
    // Each `*_announce_*` function chooses its own wording and its own
    // audience. One that took a subject and a body from its caller would be
    // notify_send with a different name and without its admin check — which is
    // how a teacher comes to send a message that looks like the principal's.
    const all = migrations().map(({ sql }) => withoutComments(sql)).join("\n");
    const offenders: string[] = [];

    for (const match of all.matchAll(
      /create\s+or\s+replace\s+function\s+public\.(\w*_announce_\w+)\s*\(([^)]*)\)/gi,
    )) {
      const [, name, args] = match;
      if (/p_subject|p_body|p_message|p_audience/i.test(args)) {
        offenders.push(`${name}(${args.trim()})`);
      }
    }

    expect(
      offenders,
      "A raiser writes its own words. Accepting a subject, body or audience " +
        "from the caller reopens the hole notify_send's admin check closes.",
    ).toEqual([]);
  });
});
