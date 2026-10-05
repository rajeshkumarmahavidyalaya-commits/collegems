import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { admissionSchema, studentSchema } from "@/lib/validations/students";
import { formPanels, missingRequired, numbering, requiredFieldNames, requiredSwitches } from "@/lib/validations/admission-required";

/**
 * A student is admitted into a class and with a kind of student (0328), and a
 * college may require more of the form (0330). The form marks and checks; the
 * server action is the gate, so both are pinned here.
 */
const base = {
  firstName: "Asha",
  lastName: "Verma",
  admissionNumber: "A-1",
  admissionDate: "2026-04-01",
  status: "active" as const,
};
const uuid = "3f2a8c4e-1b7d-4e2a-9c3f-5d6e7f8a9b0c";

describe("admission names a class and a kind of student", () => {
  it("is refused without a section, and without a kind", () => {
    expect(admissionSchema.safeParse(base).success).toBe(false);
    expect(admissionSchema.safeParse({ ...base, sectionId: uuid }).success).toBe(false);
    expect(admissionSchema.safeParse({ ...base, studentTypeId: uuid }).success).toBe(false);
    expect(admissionSchema.safeParse({ ...base, sectionId: uuid, studentTypeId: uuid }).success).toBe(true);
  });

  it("an edit keeps both optional, because an alumnus has no class this year", () => {
    expect(studentSchema.safeParse(base).success).toBe(true);
  });

  it("the server action parses with the admission schema", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(app)/students/actions.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function admitStudent"));
    expect(body.slice(0, 800)).toMatch(/admissionSchema\.safeParse\(input\)/);
    // The college's required fields, the photograph counted as a field (0331).
    expect(body).toMatch(/missingRequired\(\{ \.\.\.parsed\.data, photo: hasPhoto \}, settings\.required\)/);
    // The roll number is filled in before the check it would otherwise fail.
    expect(body.indexOf("next_roll_number")).toBeLessThan(body.indexOf("missingRequired("));
  });
});

describe("fields a college requires at admission", () => {
  it("reads only switched-on keys it knows, and maps them to the form", () => {
    expect(requiredFieldNames({ date_of_birth: true, phone: false, nonsense: true, medium: true, last_name: false })).toEqual(["dateOfBirth", "mediumId"]);
    expect(requiredFieldNames({ religion: true, student_photo: true, country: true })).toEqual(["lastName", "religion", "photo", "country"]);
  });

  it("keeps the last name required for a college that never said otherwise (0331)", () => {
    // The form before the switch existed required it; silence keeps that form.
    expect(requiredFieldNames(null)).toEqual(["lastName"]);
    expect(requiredFieldNames({})).toEqual(["lastName"]);
    expect(requiredSwitches(null).last_name).toBe(true);
    expect(requiredSwitches({ last_name: false }).last_name).toBe(false);
  });

  it("counts a missing photograph as a missing field", () => {
    expect(missingRequired({ photo: false }, ["photo"])).toEqual({ photo: ["Student photo is required"] });
    expect(missingRequired({ photo: true }, ["photo"])).toEqual({});
  });

  it("names each missing field, and treats blanks as missing", () => {
    const required = ["dateOfBirth", "phone"];
    expect(Object.keys(missingRequired({ dateOfBirth: "", phone: "  " }, required))).toEqual(["dateOfBirth", "phone"]);
    expect(missingRequired({ dateOfBirth: "2015-01-01", phone: "98" }, required)).toEqual({});
  });
});

describe("the admission form's panels and numbers (0331)", () => {
  it("draws the form as it was until a college chooses otherwise", () => {
    expect(formPanels(null)).toEqual({
      parent_details: false,
      parent_login: false,
      student_login: false,
      transport: true,
      fees: false,
      survey: false,
    });
    expect(formPanels({ transport: false, survey: true, nonsense: true }).transport).toBe(false);
    expect(numbering(null)).toEqual({ autoAdmissionNumber: false, admissionPrefix: "", autoRollNumber: false });
  });

  it("keeps the catalogue's defaults and these in step", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0331_registration_settings_as_the_reference_has_them.sql"), "utf8");
    const panels = sql.slice(sql.indexOf("'admissions.form_panels'"));
    const defaults = JSON.parse(panels.match(/'(\{"parent_details"[^']*)'::jsonb/)![1]);
    expect(defaults).toEqual(formPanels(null));
  });

  it("keeps the sensitive half of a record away from every staff role but the administrator", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0331_registration_settings_as_the_reference_has_them.sql"), "utf8").replace(/--.*$/gm, "");
    const policies = [...sql.matchAll(/create policy "([^"]+)" on public\.student_profiles\s+for (\w+)[\s\S]*?;/g)];
    expect(policies.map((m) => m[1]).sort()).toEqual([
      "admins manage student_profiles",
      "parents view own children profiles",
      "students view own profile",
    ]);
    for (const m of policies) expect(m[0]).not.toMatch(/'teacher'|'accountant'|'librarian'/);
  });
});

describe("a class arrives with its sections", () => {
  it("class_level_add refuses an empty list of sections and writes both in one function", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0328_medium_house_and_kinds_of_student.sql"), "utf8").replace(/--.*$/gm, "");
    const body = sql.slice(sql.indexOf("create or replace function public.class_level_add"));
    expect(body).toMatch(/if cardinality\(v_sections\) = 0 then\s+raise exception/);
    expect(body.indexOf("insert into public.class_levels")).toBeLessThan(body.indexOf("insert into public.sections"));
    expect(body).toMatch(/pg_advisory_xact_lock/);
  });

  it("the class form asks for sections and no longer for a position", () => {
    const tab = readFileSync(join(process.cwd(), "src/app/(app)/academics/classes-tab.tsx"), "utf8");
    expect(tab).not.toMatch(/Position \(optional\)/);
    expect(tab).toMatch(/htmlFor="class-sections"/);
  });
});
