import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ON_ROLL } from "@/lib/enrolment";

/*
 * An earlier year can be opened and read, and is never written (0355, 0356).
 * Reported as "after promotion the previous data vanished": nothing had, but
 * every screen read only the working year, and the closed year's enrolments
 * were all `promoted`, which every read model skipped.
 */

const ROOT = process.cwd();
const migrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripSql = (s: string) => s.replace(/--.*$/gm, "");

/** The latest migration that defines a function, as its body. */
function latestDefinition(name: string): string {
  let found = "";
  for (const f of migrations) {
    const s = stripSql(read(`supabase/migrations/${f}`));
    const at = s.search(new RegExp(`create (or replace )?function public\\.${name}\\s*\\(`, "i"));
    if (at >= 0) found = s.slice(at, s.indexOf("$$;", s.indexOf("$$", at) + 2) + 3);
  }
  return found;
}

describe("the year on screen", () => {
  it("current_session_id answers with the chosen year before the working one", () => {
    const body = latestDefinition("current_session_id");
    expect(body).toMatch(/coalesce\(\s*\(select public\.viewing_session_id\(p_tenant_id\)\)/);
    expect(body).toContain("is_current");
  });

  it("stays plain SQL, so Postgres inlines it and asks once per query (0357)", () => {
    // As PL/pgSQL it ran per row: module_cards took 1,727 ms and a page hit
    // the 8 s statement timeout.
    for (const name of ["current_session_id", "viewing_session_id"]) {
      expect(latestDefinition(name), name).toMatch(/language sql/i);
      expect(latestDefinition(name), name).not.toMatch(/language plpgsql/i);
    }
  });

  it("only a year of the caller's own college counts", () => {
    const body = latestDefinition("viewing_session_id");
    expect(body).toContain("x-schoolos-year");
    expect(body).toMatch(/s\.tenant_id = p_tenant_id/);
  });
});

describe("a year that is not the working year is read-only", () => {
  const guard = latestDefinition("request_year_guard");

  it("is PostgREST's pre-request hook", () => {
    const all = migrations.map((f) => stripSql(read(`supabase/migrations/${f}`))).join("\n");
    expect(all).toMatch(/alter role authenticator set pgrst\.db_pre_request to 'public\.request_year_guard'/);
  });

  it("makes the transaction read-only, and only when the year is not the working one", () => {
    expect(guard).toContain("set_config('transaction_read_only', 'on', true)");
    expect(guard).toMatch(/s\.is_current/);
  });

  it("never raises: it runs before every request, so an error would take down every screen", () => {
    expect(guard).not.toMatch(/\braise\b/i);
    expect(guard).toMatch(/exception when others then\s+return;/);
  });
});

describe("only the server carries the year", () => {
  it("the server client sends the header from the cookie, through the year-aware fetch", () => {
    const server = read("src/lib/supabase/server.ts");
    expect(server).toContain("chosenYear()");
    expect(server).toMatch(/\[YEAR_HEADER\]: year/);
    expect(server).toContain('body.code === "25006"');
  });

  it("nothing else names the header: a browser-side picker would be a second answer", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && read(path.slice(ROOT.length + 1)).includes("x-schoolos-year"))
          offenders.push(path.slice(ROOT.length + 1));
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders).toEqual(["src/lib/academic-year.ts"]);
  });
});

describe("a closed year keeps its roll", () => {
  it("the app and the SQL read models agree on which enrolments were on a year's roll", () => {
    const sql = stripSql(read("supabase/migrations/0356_a_closed_year_keeps_its_roll.sql"));
    const list = sql.match(/\.status in \(([^)]*)\)/)![1];
    const statuses = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(statuses).toEqual([...ON_ROLL]);
  });

  it("withdrawn and transferred children are not on it", () => {
    expect(ON_ROLL).not.toContain("withdrawn");
    expect(ON_ROLL).not.toContain("transferred_out");
  });
});
