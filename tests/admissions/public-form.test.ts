import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMISSION_LIMITS,
  PHONE_PATTERN,
  applicationPayload,
  applicationSchema,
  isRealPastDate,
  refusalKey,
} from "@/lib/validations/admissions";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function sql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** The latest definition, anchored on `create ... function` (see rule 10's note on `lastIndexOf`). */
function functionBody(name: string): string {
  let found = "";
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const body = sql(readFileSync(join(MIGRATIONS, file), "utf8"));
    const pattern = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const rest = body.slice(match.index);
      const end = rest.indexOf("\n$$;");
      found = end === -1 ? rest : rest.slice(0, end);
    }
  }
  return found;
}

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/**
 * The public application form: the product's first deliberate anonymous write
 * path (migration 0268).
 *
 * `admission_apply` is the gate — `SECURITY DEFINER`, granted to `anon`, and
 * re-checking every bound in its own body. The TypeScript schema is a copy of
 * those bounds kept only so a refusal arrives in the reader's language, and a
 * second copy is only safe to keep while something fails when the two
 * disagree. This is that something.
 */
describe("the public application form", () => {
  const apply = functionBody("admission_apply");
  const form = functionBody("admission_form");

  it("finds both functions", () => {
    expect(apply).toContain("security definer");
    expect(form).toContain("security definer");
  });

  describe("the caller decides the child and the contact, and nothing else", () => {
    it("the year, the number, the source and the status are decided inside", () => {
      expect(apply).toContain("public.current_session_id(v_tenant.id)");
      expect(apply).toContain("public.fees_next_document_number_for(v_tenant.id, v_session_id, 'enquiry')");
      expect(apply).toMatch(/'website',\s*'new'/);
    });

    it("the function reads exactly the keys the action sends", () => {
      // Both directions: a key the SQL reads and the action never sends is a
      // field nobody can fill; a key the action sends and the SQL never reads
      // is a field dropped on the floor (rule 5's importer, one module along).
      const readBySql = new Set([...apply.matchAll(/p_application ->> '(\w+)'/g)].map((m) => m[1]));
      const sent = new Set(
        Object.keys(
          applicationPayload({
            firstName: "a",
            lastName: "b",
            dateOfBirth: "2010-01-01",
            gender: "female",
            classLevelId: "00000000-0000-4000-8000-000000000000",
            contactName: "c",
            relationship: "d",
            contactPhone: "9999999999",
            contactEmail: "e@example.com",
            notes: "f",
          }),
        ),
      );
      expect([...readBySql].sort()).toEqual([...sent].sort());
    });

    it("the caller cannot name the college's id, the year, the source or the status", () => {
      for (const forbidden of ["tenant_id", "session_id", "source", "status", "enquiry_number"]) {
        expect(apply, `admission_apply reads ${forbidden} from its caller`).not.toContain(
          `p_application ->> '${forbidden}'`,
        );
      }
    });
  });

  describe("the two copies of each bound agree", () => {
    it.each([
      ["a name", "length(v_first) > 80 or length(v_last) > 80", ADMISSION_LIMITS.name, 80],
      ["the contact's name", "length(v_contact) > 120", ADMISSION_LIMITS.contactName, 120],
      ["the relationship", "length(v_relationship) > 40", ADMISSION_LIMITS.relationship, 40],
      ["the message", "length(v_notes) > 1000", ADMISSION_LIMITS.notes, 1000],
      ["an email", "length(v_email) > 200", ADMISSION_LIMITS.email, 200],
    ])("%s", (_what, clause, ts, expected) => {
      expect(apply).toContain(clause);
      expect(ts).toBe(expected);
    });

    it("the phone pattern, character for character", () => {
      expect(apply).toContain(`v_phone !~ '${PHONE_PATTERN.source}'`);
    });

    it("every refusal the action maps is one the function still raises", () => {
      // A mapping whose sentence was reworded in SQL would silently fall
      // through to the English original -- not wrong, but no longer translated.
      const raised = [...apply.matchAll(/raise exception '([^']*(?:''[^']*)*)'/g)].map((m) =>
        m[1].replace(/''/g, "'"),
      );
      // Distinct keys, not raises: "Choose a class from the list" is raised at
      // two points (a malformed id, and an id from another college), and the
      // first draft of this line counted raises and reported a correct function.
      const mapped = new Set(raised.map(refusalKey).filter((k) => k !== null));
      expect([...mapped].sort()).toEqual(["apply.closed.body", "apply.error.busy", "apply.error.classLevel"]);
    });
  });

  describe("what an anonymous caller may learn", () => {
    it("the form's projection is a name, a year, class levels and the college's note", () => {
      const built = form.slice(form.indexOf("return jsonb_build_object("));
      const keys = [...built.matchAll(/^\s*'(\w+)',/gm)].map((m) => m[1]);
      expect(keys.sort()).toEqual(["class_levels", "college", "note", "session", "slug"]);
    });

    it("one null for every reason, never a sentence that distinguishes them", () => {
      // Unknown slug, closed college, no current year: three `return null`s.
      expect(form.match(/return null;/g)?.length).toBe(3);
      expect(form).not.toMatch(/raise exception/);
    });

    it("the closed refusal on the write is one sentence for all three reasons", () => {
      expect(apply.match(/This college is not taking applications online/g)?.length).toBe(1);
    });
  });

  describe("bounded", () => {
    it("the hourly limit is checked under an advisory lock, after the duplicate check", () => {
      const lock = apply.indexOf("pg_advisory_xact_lock");
      const duplicate = apply.indexOf("if v_existing is not null");
      const limit = apply.indexOf("if v_recent >= v_per_hour");
      expect(lock).toBeGreaterThan(-1);
      expect(duplicate).toBeGreaterThan(lock);
      expect(limit).toBeGreaterThan(duplicate);
      expect(apply).toContain("least(coalesce((v_setting ->> 'per_hour')::integer, 30), 500)");
    });

    it("arrives closed", () => {
      const migration = read("supabase", "migrations", "0268_an_application_form_nobody_has_to_sign_in_for.sql");
      expect(migration).toContain(`'{"enabled": false, "per_hour": 30, "note": null}'::jsonb`);
    });
  });
});

describe("the route", () => {
  it("is public in the middleware, and nothing else was made public with it", () => {
    const middleware = read("src", "middleware.ts");
    expect(middleware).toMatch(
      /const PUBLIC_PATHS = \["\/login", "\/signup", "\/auth", "\/api\/health", "\/apply"\];/,
    );
  });

  it("the browser half imports nothing, so an applicant is never sent Zod", () => {
    const display = read("src", "lib", "validations", "admissions-display.ts");
    expect(display).not.toMatch(/^import /m);
    const form = read("src", "app", "apply", "[slug]", "apply-form.tsx");
    expect(form).not.toContain("@/lib/validations/admissions\"");
  });

  it("the action sends no college id, year, source or status", () => {
    const action = read("src", "app", "apply", "[slug]", "actions.ts");
    expect(action).toContain('supabase.rpc("admission_apply"');
    for (const forbidden of ["tenant_id", "session_id", "p_source", "status:"]) {
      expect(action).not.toContain(forbidden);
    }
  });
});

describe("the schema", () => {
  const valid = { firstName: "Asha", contactName: "Sunita", contactPhone: "+91 98765 43210" };

  it("accepts the smallest honest application", () => {
    expect(applicationSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses an application nobody can reply to", () => {
    const r = applicationSchema.safeParse({ firstName: "Asha", contactName: "Sunita" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("apply.error.contact");
  });

  it("an email alone is enough", () => {
    expect(
      applicationSchema.safeParse({ firstName: "A", contactName: "B", contactEmail: "b@example.com" }).success,
    ).toBe(true);
  });

  it.each(["call me", "12345", "+91 98765 43210 ext 4", "९८७६५४३२१०"])("refuses the phone %j", (phone) => {
    expect(applicationSchema.safeParse({ ...valid, contactPhone: phone }).success).toBe(false);
  });

  it("every message is a catalogue key, so it can be resolved in the reader's language", async () => {
    const { en } = await import("@/lib/i18n/messages/en");
    const r = applicationSchema.safeParse({
      firstName: "",
      contactName: "",
      contactPhone: "x",
      contactEmail: "y",
      dateOfBirth: "2010-02-31",
      notes: "n".repeat(1001),
    });
    expect(r.success).toBe(false);
    for (const issue of r.error!.issues) expect(Object.keys(en)).toContain(issue.message);
  });
});

describe("isRealPastDate", () => {
  const today = "2026-09-23";
  it.each([
    ["2010-05-04", true],
    ["2010-02-31", false], // not a day
    ["2026-09-24", false], // tomorrow
    ["2026-09-23", true], // today, inclusive like the SQL
    ["1926-09-23", true], // exactly a century, inclusive like the SQL
    ["1926-09-22", false],
  ])("%s -> %s", (iso, expected) => {
    expect(isRealPastDate(iso, today)).toBe(expected);
  });
});
