import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BIOMETRIC_CODE_PATTERN } from "@/lib/validations/biometric-display";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const MIGRATION = "0273_a_punch_is_a_machine_s_observation.sql";

/** Comments out, then match: a comment can hide a violation and fake one. */
function sql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** The latest definition, anchored on `create ... function`, never on a comment. */
function functionBody(name: string): string {
  let found = "";
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const body = sql(readFileSync(join(MIGRATIONS, file), "utf8"));
    const pattern = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(body)) !== null) {
      const rest = body.slice(m.index);
      found = rest.slice(0, rest.indexOf("\n$$;"));
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const migration = sql(readFileSync(join(MIGRATIONS, MIGRATION), "utf8"));

/**
 * Attendance readers (migration 0273): a machine's observation, written by a
 * definer nothing holding a JWT may call, that never overrules a person.
 */
describe("the ingest is a door only the Edge Function has a key to", () => {
  const ingest = functionBody("biometric_ingest");

  it("is a definer with an empty search_path", () => {
    expect(ingest).toMatch(/security definer\s+set search_path = ''/);
  });

  it("is revoked from everybody holding a JWT and granted to the service role alone", () => {
    expect(migration).toMatch(
      /revoke all on function public\.biometric_ingest\(uuid, text, jsonb\) from public, anon, authenticated;/,
    );
    const grants = [...migration.matchAll(/grant execute on function public\.biometric_ingest\([^)]*\) to ([^;]+);/g)];
    expect(grants.map((g) => g[1].trim())).toEqual(["service_role"]);
  });

  it("takes the tenant from the device row, never from its caller", () => {
    // The signature is the whole of what a caller supplies.
    expect(ingest).toMatch(/biometric_ingest\(\s*p_device_id uuid,\s*p_secret text,\s*p_punches jsonb\s*\)/);
    expect(ingest).not.toMatch(/current_tenant_id|p_tenant/);
  });

  it("resolves the year by tenant itself: academics_session_for_date relies on RLS, and no policy runs here", () => {
    expect(ingest).not.toContain("academics_session_for_date");
    expect(ingest).not.toContain("current_session_id");
    expect(ingest).toMatch(/a\.tenant_id = v_device\.tenant_id\s+and t\.on_date between a\.start_date and a\.end_date/);
  });

  it("matches a code to active staff of the device's own college only", () => {
    expect(ingest).toMatch(
      /where s\.tenant_id = v_device\.tenant_id\s+and s\.biometric_code = v_code\s+and s\.status = 'active'/,
    );
  });

  it("compares the secret's hash, and refuses every kind of wrong device in one sentence", () => {
    expect(ingest).toContain("encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')");
    expect([...ingest.matchAll(/errcode = '28000'/g)]).toHaveLength(1);
  });
});

describe("the reader never overrules a person", () => {
  it("updates a register row only where the reader wrote it", () => {
    const ingest = functionBody("biometric_ingest");
    const upsert = ingest.slice(ingest.indexOf("insert into public.staff_attendance"));
    expect(upsert).toMatch(/on conflict \(tenant_id, staff_id, attendance_date\) do update[\s\S]*?where sa\.source = 'reader';/);
    // Nothing but the times: a reader cannot change what status a person chose.
    const set = upsert.slice(upsert.indexOf("do update"), upsert.indexOf("where sa.source"));
    expect(set).not.toMatch(/status\s*=/);
  });

  it("a person marking the register takes a reader row over, on insert and on conflict", () => {
    const mark = functionBody("hr_mark_attendance");
    expect(mark).toMatch(/auth\.uid\(\),\s*'register'\s*\)/);
    expect(mark).toMatch(/source = 'register',/);
  });
});

describe("the secret is not readable back", () => {
  it("secret_hash is outside the column grant", () => {
    expect(migration).toMatch(/revoke select on public\.biometric_devices from authenticated, anon;/);
    const grant = migration.match(/grant select \(([^)]*)\)\s+on public\.biometric_devices to authenticated;/);
    expect(grant).not.toBeNull();
    expect(grant![1]).not.toContain("secret_hash");
  });

  it("the punches are append-only by revoke", () => {
    expect(migration).toMatch(/revoke insert, update, delete on public\.biometric_punches from authenticated, anon;/);
  });
});

describe("the browser's copy of the code rule", () => {
  it("is the CHECK, character for character", () => {
    const checks = [...migration.matchAll(/check \((?:biometric_code|device_user_code) ~ '([^']+)'\)/g)].map((m) => m[1]);
    expect(checks).toHaveLength(2);
    for (const c of checks) expect(BIOMETRIC_CODE_PATTERN.source).toBe(c);
  });
});

describe("the application never calls the ingest", () => {
  it("no file under src/ calls it: only the Edge Function holds the service key", () => {
    // Anchored to the call, not the name: the generated types list every
    // function in the schema, and a doc comment wraps it in backticks that
    // look exactly like a template literal. Neither is a caller.
    const hits = sourceFiles(join(ROOT, "src"))
      .filter((f) => !f.endsWith("database.types.ts"))
      .filter((f) => /\.rpc\(\s*["'`]biometric_ingest["'`]/.test(readFileSync(f, "utf8")))
      .join("\n");
    expect(hits).toBe("");
  });

  it("the Edge Function sends the device's id and secret and nothing that names a college", () => {
    const fn = readFileSync(join(ROOT, "supabase", "functions", "biometric-punch", "index.ts"), "utf8");
    const call = fn.slice(fn.indexOf('rpc("biometric_ingest"'), fn.indexOf("});", fn.indexOf('rpc("biometric_ingest"')));
    expect(call).toContain("p_device_id");
    expect(call).toContain("p_secret");
    expect(call).not.toMatch(/tenant/i);
  });
});
