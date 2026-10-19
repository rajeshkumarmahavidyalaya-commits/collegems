import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENQUIRY_KEYS,
  STAFF_APPLICATION_KEYS,
  publicRefusalKey,
  readAdmitCard,
  readCertificate,
  readCollege,
  readResults,
  readTimetable,
  timeRange,
} from "@/lib/validations/public-pages";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function sql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** The latest definition, anchored on `create ... function` (rule 10's note on `lastIndexOf`). */
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
 * A college's public pages (migrations 0361-0363): six more things anybody can
 * do without an account. Each is an anonymous definer, so its own body is the
 * only check there is, and these are the properties that body has to keep.
 */
describe("the public pages", () => {
  const lookups = ["public_admit_card", "public_results", "public_certificate_check"] as const;
  const writes = ["public_enquiry", "public_staff_apply"] as const;
  const all = ["public_college", "public_exam_timetable", ...lookups, ...writes] as const;

  it("finds every function, each a definer that sets its own search path", () => {
    for (const name of all) {
      const body = functionBody(name);
      expect(body, name).toContain("security definer");
      expect(body, name).toMatch(/set search_path = ''/);
    }
  });

  it("every page but the index asks whether its own page is switched on", () => {
    const page: Record<string, string> = {
      public_exam_timetable: "exam_timetable",
      public_admit_card: "admit_cards",
      public_results: "results",
      public_certificate_check: "certificate_check",
      public_enquiry: "enquiry",
      public_staff_apply: "staff_application",
    };
    for (const [name, key] of Object.entries(page)) {
      expect(functionBody(name), name).toContain(`public.public_page_tenant(p_slug, '${key}')`);
    }
  });

  it("every lookup is counted before it looks anything up", () => {
    // Counted whatever it finds: a wrong date of birth costs a lookup too, or
    // the limit would bound only the people it is not for.
    for (const name of lookups) {
      const body = functionBody(name);
      const take = body.indexOf("public.public_page_take(v_tenant, 'lookup')");
      expect(take, name).toBeGreaterThan(-1);
      const firstRead = Math.min(
        ...["public.public_student_match", "from public.certificates"].map((s) => {
          const i = body.indexOf(s);
          return i === -1 ? Infinity : i;
        }),
      );
      expect(take, `${name} looks before it counts`).toBeLessThan(firstRead);
    }
  });

  it("every lookup needs a date of birth, never an id alone", () => {
    // Admission numbers and certificate serials are sequential: one fact a
    // stranger can step through is not a lookup, it is a listing.
    for (const name of lookups) {
      expect(functionBody(name), name).toMatch(/p_date_of_birth date/);
    }
    expect(functionBody("public_student_match")).toContain("p.date_of_birth = p_date_of_birth");
    expect(functionBody("public_certificate_check")).toContain("v_dob <> p_date_of_birth");
  });

  it("the helpers are not callable by anybody with a JWT", () => {
    for (const name of ["public_page_tenant", "public_page_take", "public_student_match", "student_takes_subject_for"]) {
      const source = readdirSync(MIGRATIONS)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => sql(readFileSync(join(MIGRATIONS, f), "utf8")))
        .join("\n");
      expect(source, name).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
    }
  });

  it("the admit card asks the tenant-parameterised elective check, not the token's", () => {
    // student_takes_subject reads current_tenant_id(), which an anonymous
    // caller does not have: asked as-is it would say every child takes every
    // elective, and an admit card would list papers the child does not sit.
    const body = functionBody("public_admit_card");
    expect(body).toContain("public.student_takes_subject_for(v_tenant,");
    expect(body).not.toMatch(/public\.student_takes_subject\(/);
    expect(functionBody("student_takes_subject")).toContain("public.student_takes_subject_for(public.current_tenant_id()");
  });

  describe("the functions read exactly the keys the actions send", () => {
    // Both directions: a key the SQL reads and the action never sends is a
    // field nobody can fill; one the action sends and the SQL never reads is a
    // field dropped on the floor.
    for (const [fn, param, keys] of [
      ["public_enquiry", "p_enquiry", ENQUIRY_KEYS],
      ["public_staff_apply", "p_application", STAFF_APPLICATION_KEYS],
    ] as const) {
      it(fn, () => {
        const body = functionBody(fn);
        const readBySql = new Set([...body.matchAll(new RegExp(`${param} ->> '(\\w+)'`, "g"))].map((m) => m[1]));
        expect([...readBySql].sort()).toEqual([...keys].sort());
      });
    }

    it("the actions send those keys and no college, year, source or status", () => {
      const actions = read("src", "app", "college", "[slug]", "actions.ts");
      expect(actions).toContain("ENQUIRY_KEYS.map");
      expect(actions).toContain("STAFF_APPLICATION_KEYS.map");
      expect(actions).not.toMatch(/tenant_id|session_id|p_source|status:/);
    });
  });

  it("the route is public, and the staff screen is not", () => {
    const middleware = read("src", "middleware.ts");
    expect(middleware).toMatch(/const PUBLIC_PATHS = \[[^\]]*"\/college"[^\]]*\];/);
    expect(middleware).not.toMatch(/const PUBLIC_PATHS = \[[^\]]*"\/staff/);
  });

  it("the applicant's own words cannot be rewritten by the office", () => {
    const src = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => sql(readFileSync(join(MIGRATIONS, f), "utf8")))
      .join("\n");
    expect(src).toContain("revoke insert, update, delete on public.staff_applications from authenticated, anon;");
    expect(src).toContain(
      "grant update (status, decision_note, decided_by, decided_at, staff_id) on public.staff_applications to authenticated;",
    );
  });
});

describe("reading what an anonymous function returns", () => {
  it("one null for every refusal becomes one closed page", () => {
    expect(readCollege(null)).toBeNull();
    expect(readCollege({})).toBeNull();
    expect(readCollege("nonsense")).toBeNull();
    expect(readResults(null)).toBeNull();
    expect(readCertificate(null)).toBeNull();
    expect(readAdmitCard(null)).toBeNull();
    expect(readTimetable(null)).toBeNull();
  });

  it("a page missing from the document is closed, never open", () => {
    const c = readCollege({ college: "X", slug: "x", pages: { enquiry: true, results: "yes" } });
    expect(c?.pages.enquiry).toBe(true);
    expect(c?.pages.results).toBe(false);
    expect(c?.pages.staff_application).toBe(false);
    expect(c?.admitExams).toEqual([]);
  });

  it("reads the probe's own result document", () => {
    // The shape public_results returned for a real published result, probed in
    // a rolled-back transaction on 17 Oct 2026 (names removed).
    const r = readResults({
      student: "A",
      results: [
        {
          exam: "Half-Yearly Examination",
          session: "2025-2026",
          published_on: "2026-09-03",
          total: 412.0,
          max: 700.0,
          percentage: 58.857,
          grade: "C1",
          result: "pass",
          rank: 20,
          cohort: 25,
          subjects: [{ subject: "English", obtained: 60, max: 100, passed: true, absent: false }],
        },
      ],
    });
    expect(r?.results[0]).toMatchObject({ session: "2025-2026", percentage: 58.857, rank: 20, cohort: 25 });
    expect(r?.results[0].subjects[0]).toMatchObject({ obtained: 60, passed: true, absent: false });
  });

  it("a student with no published results is not found, not an empty card", () => {
    expect(readResults({ student: "A", results: [] })).toBeNull();
  });

  it("a cancelled certificate reads as cancelled", () => {
    expect(readCertificate({ serial: "CERT-1", status: "cancelled", cancelled_on: "2026-01-02" })?.cancelled).toBe(true);
    expect(readCertificate({ serial: "CERT-1", status: "issued" })?.cancelled).toBe(false);
  });

  it("a time of day is a wall clock", () => {
    expect(timeRange("09:30:00", "11:30:00")).toBe("09:30–11:30");
    expect(timeRange("09:30:00", null)).toBe("09:30");
    expect(timeRange(null, null)).toBeNull();
  });

  it("the functions' refusals are translated, anything else is shown as written", () => {
    expect(publicRefusalKey("Too many lookups at this college in the last hour. Please try again later.")).toBe(
      "public.lookup.busy",
    );
    expect(publicRefusalKey("This college has received a lot of enquiries in the last hour.")).toBe("public.error.busy");
    expect(publicRefusalKey("This college is not taking applications online at the moment.")).toBe("public.error.closed");
    expect(publicRefusalKey("That phone number does not look right.")).toBeNull();
  });
});
