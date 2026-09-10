import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The permission catalogue and the gates in the code, kept from drifting apart.
 *
 * Migration `0212` made the matrix editable, which is what turned this from
 * untidiness into a defect: the checkboxes are now a screen an administrator
 * reads and acts on, so the names on them have to mean what they say. They had
 * drifted in **both** directions at once:
 *
 * - `settings.manage` was used **12 times**, nine of them on screens that are
 *   not settings — creating an exam, running a promotion, setting up fee heads.
 *   A college could not let its examination officer create an exam without also
 *   handing them the school's address and its notification channels.
 * - Five codes appeared **only in the migration that seeded them**, so ticking
 *   and unticking them changed nothing anywhere.
 *
 * Both checks read the source, so they run without a database — the rule has to
 * be enforceable in every environment, and the DB-backed suites are not.
 */

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");

type Seeded = { code: string; file: string };

/**
 * Every code the catalogue declares, with the migration that declared it.
 *
 * Parsed from the `insert into reference.permissions` statements rather than
 * from a list kept here, because a list kept here is the sixth copy of
 * `library.fine_per_day`.
 */
function seededCodes(): Seeded[] {
  const found = new Map<string, string>();

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const stmt of sql.matchAll(/insert\s+into\s+reference\.permissions[\s\S]*?;/gi)) {
      // The first literal of each `('code', 'module', 'ability', '…')` tuple.
      for (const tuple of stmt[0].matchAll(/\(\s*'([a-z_]+\.[a-z_]+)'\s*,/gi)) {
        if (!found.has(tuple[1])) found.set(tuple[1], file);
      }
    }
  }

  return [...found].map(([code, file]) => ({ code, file }));
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

/**
 * Codes that are deliberately in the catalogue while nothing consults them —
 * each with the reason, in the shape `EVERY_ROLE_ON_PURPOSE` and
 * `CROSS_YEAR_ON_PURPOSE` already use.
 *
 * The bar is **the feature is unbuilt**, never "we have not got round to the
 * gate". A code whose screen exists and does not check it is the defect this
 * file was written for.
 */
const NOT_YET_A_CONTROL: Record<string, string> = {
  "guardians.manage":
    "Guardians are read-only everywhere in the product: they are rendered on the " +
    "student record and there is no create, edit or link control to gate. The " +
    "permission is right and the screen is unbuilt.",
  "certificates.manage":
    "Its catalogue row means 'write and retire certificate templates', and the " +
    "template editor does not exist — templates are seeded by migration. " +
    "Cancelling is gated on certificates.issue, whose own row says 'issue and " +
    "cancel certificates'.",
};

describe("the permission catalogue and the gates agree", () => {
  it("declares codes nothing has to guess at", () => {
    // A sanity check on the parser before the two real assertions: if the regex
    // stops matching, both of them go quietly green.
    const codes = seededCodes();
    expect(codes.length).toBeGreaterThan(60);
    expect(codes.map((c) => c.code)).toContain("settings.manage");
    expect(codes.map((c) => c.code)).toContain("exams.manage");
  });

  it("has no code that decides nothing", () => {
    const codes = seededCodes();
    const app = sourceFiles(join(ROOT, "src"), [".ts", ".tsx"]).map((f) => readFileSync(f, "utf8"));

    // Every migration with the permission-catalogue inserts cut out of it.
    //
    // The first draft excluded the whole *file* a code was seeded in, and
    // reported four false positives: a module's migration usually seeds its
    // permission AND registers the report gated on it, in that order, a few
    // lines apart. `certificates.view` is consulted — by a
    // `reference.reports` row eight lines below where it is declared. Cutting
    // the declaration rather than the file asks the question that was meant:
    // does anything *consult* this code?
    const sqlWithoutDeclarations = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) =>
        readFileSync(join(MIGRATIONS, f), "utf8").replace(
          /insert\s+into\s+reference\.permissions[\s\S]*?;/gi,
          "",
        ),
      );

    const inert: string[] = [];

    for (const { code, file } of codes) {
      if (code in NOT_YET_A_CONTROL) continue;

      const inApp = app.some((body) => body.includes(`"${code}"`) || body.includes(`'${code}'`));
      const inSql = sqlWithoutDeclarations.some((body) => body.includes(`'${code}'`));

      if (!inApp && !inSql) {
        inert.push(`${code} (declared in ${file}, consulted nowhere)`);
      }
    }

    expect(
      inert,
      "A permission a college can grant and revoke must change something: a gate " +
        "in the app, a report or check's required_permission, or a policy. One " +
        "that changes nothing is a checkbox that lies. Wire it up, or name it in " +
        "NOT_YET_A_CONTROL with the reason its feature is unbuilt.",
    ).toEqual([]);
  });

  it("keeps settings.manage on screens that are actually settings", () => {
    // The other direction: one permission quietly acquiring nine jobs. The two
    // legitimate homes are the school's own profile and the channel switches --
    // both configuration of the college itself.
    const ALLOWED = ["settings/school", "notifications/channels"];
    const offenders: string[] = [];

    for (const file of sourceFiles(join(ROOT, "src/app"), [".ts", ".tsx"])) {
      const body = readFileSync(file, "utf8");
      if (!/hasPermission\(\s*"settings\.manage"/.test(body)) continue;

      const rel = file.slice(ROOT.length + 1);
      if (!ALLOWED.some((a) => rel.includes(a))) offenders.push(rel);
    }

    expect(
      offenders,
      "settings.manage means the college's own configuration. A screen that " +
        "needs its own permission should have one -- exams.manage, fees.manage, " +
        "promotion.manage and academics.manage all exist -- because a college " +
        "delegating exams should not thereby be delegating the school address.",
    ).toEqual([]);
  });
});
