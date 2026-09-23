import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** Comments stripped, so the guard reads the SQL and not the prose about it. */
function sql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

type FunctionState = {
  exists: boolean;
  /** Whether anon (directly, or through PUBLIC) can execute it right now. */
  anon: boolean;
  definer: boolean;
  trigger: boolean;
  file: string;
};

/**
 * Replays every migration's function DDL in order and says, per function,
 * whether an anonymous caller can execute it at the end.
 *
 * The privilege model is Postgres's own, and it has one subtlety that the first
 * draft of this file got wrong:
 *
 * - a **new** function grants EXECUTE to PUBLIC (and, on Supabase, to `anon`
 *   by default privilege) — so it starts exposed;
 * - **`create or replace` of an existing function keeps its grants.** Treating
 *   every `create or replace` as a reset reported `privilege_guard_violations`,
 *   revoked in `0159` and redefined in `0160`, as exposed — a correct function
 *   named as a defect;
 * - a `drop function` forgets everything, so the next `create` starts exposed
 *   again — which is exactly how a `drop` + `create` to change a return type
 *   quietly re-opens a function somebody had closed.
 *
 * Checked against the live database before being trusted: this replay names
 * the same two functions `definer_guard_violations()` named before `0267`
 * (`schedule_run`, `job_cancel`) and the same zero after it, over the same 49
 * definers.
 */
function replayFunctionPrivileges(files: { name: string; body: string }[]) {
  const state = new Map<string, FunctionState>();
  for (const { name: file, body } of files) {
    const src = sql(body);
    type Event =
      | { at: number; kind: "create"; name: string; definer: boolean; trigger: boolean }
      | { at: number; kind: "drop" | "revoke" | "grant"; name: string };
    const events: Event[] = [];

    for (const m of src.matchAll(/create (?:or replace )?function public\.(\w+)\s*\(/gi)) {
      const rest = src.slice(m.index);
      const end = rest.indexOf("\n$$");
      const attrs = rest.slice(0, end === -1 ? 3000 : end);
      const bodyStart = attrs.search(/\bas\s+\$/i);
      const head = bodyStart === -1 ? attrs : attrs.slice(0, bodyStart);
      events.push({
        at: m.index!,
        kind: "create",
        name: m[1],
        definer: /security\s+definer/i.test(head),
        trigger: /returns\s+trigger/i.test(head),
      });
    }
    for (const m of src.matchAll(/drop function (?:if exists )?public\.(\w+)/gi)) {
      events.push({ at: m.index!, kind: "drop", name: m[1] });
    }
    for (const m of src.matchAll(
      /revoke\s+[\w ,]+?\s+on\s+function\s+public\.(\w+)\s*(?:\([^;]*?\))?\s+from\s+([^;]+);/gi,
    )) {
      if (/\b(anon|public)\b/i.test(m[2])) events.push({ at: m.index!, kind: "revoke", name: m[1] });
    }
    for (const m of src.matchAll(
      /grant\s+(?:all|execute)\s+on\s+function\s+public\.(\w+)\s*(?:\([^;]*?\))?\s+to\s+([^;]+);/gi,
    )) {
      if (/\b(anon|public)\b/i.test(m[2])) events.push({ at: m.index!, kind: "grant", name: m[1] });
    }

    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      const s: FunctionState = state.get(e.name) ?? {
        exists: false,
        anon: false,
        definer: false,
        trigger: false,
        file,
      };
      if (e.kind === "create") {
        if (!s.exists) s.anon = true;
        s.exists = true;
        s.definer = e.definer;
        s.trigger = e.trigger;
        s.file = file;
      } else if (e.kind === "drop") {
        s.exists = false;
        s.anon = false;
      } else if (e.kind === "revoke") {
        s.anon = false;
      } else {
        s.anon = true;
      }
      state.set(e.name, s);
    }
  }
  return state;
}

/** The allowlist, read out of the latest `definer_guard_violations()`, with each reason. */
function anonymousOnPurpose(): { name: string; why: string }[] {
  let body = "";
  for (const file of migrationFiles()) {
    const src = sql(readFileSync(join(MIGRATIONS, file), "utf8"));
    const at = src.search(/create (?:or replace )?function public\.definer_guard_violations\s*\(/);
    if (at === -1) continue;
    const rest = src.slice(at);
    body = rest.slice(0, rest.indexOf("\n$$;"));
  }
  const list = body.match(/anonymous_on_purpose\s*\(name, why\)\s*as\s*\(\s*values([\s\S]*?)\n\s*\)/);
  return list
    ? [...list[1].matchAll(/\(\s*'(\w+)',\s*'([^']*)'\s*\)/g)].map((m) => ({ name: m[1], why: m[2] }))
    : [];
}

/**
 * Rule 1's fifth guard, asked of the migrations rather than the database, so it
 * runs where the DB suites skip.
 *
 * > **A definer function is a privilege, not a helper.** Inside it no policy
 * > runs, so its EXECUTE grant is the only check there is.
 *
 * `schedule_run` is why: definer, no caller check, and callable with the
 * publishable key that ships in every browser bundle. Probed as `anon` before
 * `0267`, it ran a college's switched-off fee reminder. Its caller,
 * `schedules_tick`, had been revoked correctly — *the door was locked and the
 * room behind it was not.*
 */
describe("no SECURITY DEFINER function is anonymous by accident", () => {
  const files = migrationFiles().map((name) => ({
    name,
    body: readFileSync(join(MIGRATIONS, name), "utf8"),
  }));
  const state = replayFunctionPrivileges(files);
  const onPurpose = anonymousOnPurpose();
  const allowed = onPurpose.map((e) => e.name);

  it("reads the schema at all", () => {
    // A replay that found nothing passes on nothing. 49 on the day this was
    // written; the floor is loose so adding a definer never fails this line.
    const definers = [...state.values()].filter((s) => s.exists && s.definer && !s.trigger);
    expect(definers.length).toBeGreaterThan(40);
  });

  it("the allowlist is the SQL guard's own list, and every entry says why", () => {
    // Read from `definer_guard_violations()` rather than copied here, so the
    // database guard and this one cannot disagree about who is on purpose. An
    // empty parse would make every check below vacuous, so it fails first.
    expect(allowed).toContain("platform_slug_available");
    for (const { name, why } of onPurpose) {
      expect(why.trim().length, `${name} is on the list with no reason`).toBeGreaterThan(20);
    }
  });

  it("every definer anon can execute is on the list", () => {
    const exposed = [...state.entries()]
      .filter(([name, s]) => s.exists && s.definer && !s.trigger && s.anon && !allowed.includes(name))
      .map(([name, s]) => `${name} (${s.file})`);
    expect(
      exposed,
      "revoke execute from public, anon -- or name the function in definer_guard_violations() with its reason",
    ).toEqual([]);
  });

  it("an entry on the list is a definer that anon really can execute", () => {
    // Read both ways: an allowlist line for a function that has since been
    // revoked, dropped or made INVOKER explains a decision nobody is making.
    for (const name of allowed) {
      const s = state.get(name);
      expect(s?.exists && s.definer && s.anon, `${name} is on the list and is not exposed`).toBe(true);
    }
  });

  describe("the replay itself", () => {
    // Synthetic, so a control does not expire when a real defect is fixed.
    const run = (...bodies: string[]) =>
      replayFunctionPrivileges(bodies.map((body, i) => ({ name: `${i}.sql`, body })));
    const definer = (name: string) =>
      `create or replace function public.${name}() returns int language sql security definer as $$ select 1 $$;`;

    it("a new definer starts exposed", () => {
      expect(run(definer("f")).get("f")?.anon).toBe(true);
    });

    it("a revoke from anon closes it, and create or replace keeps it closed", () => {
      const s = run(
        definer("f") + "\nrevoke all on function public.f() from public, anon;",
        definer("f"),
      );
      expect(s.get("f")?.anon).toBe(false);
    });

    it("a drop then create re-opens it", () => {
      const s = run(
        definer("f") + "\nrevoke all on function public.f() from public, anon;",
        "drop function if exists public.f();\n" + definer("f"),
      );
      expect(s.get("f")?.anon).toBe(true);
    });

    it("a revoke that names only authenticated leaves anon in", () => {
      const s = run(definer("f") + "\nrevoke all on function public.f() from authenticated;");
      expect(s.get("f")?.anon).toBe(true);
    });

    it("a commented-out revoke is not a revoke", () => {
      const s = run(definer("f") + "\n-- revoke all on function public.f() from public, anon;");
      expect(s.get("f")?.anon).toBe(true);
    });

    it("a trigger function is recognised, and an invoker one is not a definer", () => {
      const s = run(
        "create function public.t() returns trigger language plpgsql security definer as $$ begin return new; end $$;",
        "create function public.i() returns int language sql as $$ select 1 $$;",
      );
      expect(s.get("t")?.trigger).toBe(true);
      expect(s.get("i")?.definer).toBe(false);
    });
  });
});
