"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { photoUrl } from "../photo-actions";
import { MAX_CARDS_PER_RUN, type IdCard, type SchoolIdentity } from "@/lib/validations/id-card";

export type CardSet =
  | { ok: true; cards: IdCard[]; school: SchoolIdentity }
  | { ok: false; reason: "too-many"; count: number };

type ProfileRow = {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  phone?: string | null;
};

/**
 * The school's own name and address, for the top of every card.
 *
 * `settings` is readable by every tenant member, so this needs no gate of its
 * own — and rule 12 is explicit that nothing secret may live there, which is
 * exactly why it is safe to print.
 */
async function schoolIdentity(): Promise<SchoolIdentity> {
  const [ctx, supabase] = await Promise.all([getUserContext(), createClient()]);
  const { data } = await supabase.rpc("setting_value", { p_key: "school.profile" });
  const profile = (data ?? {}) as ProfileRow;

  const addressLine =
    [profile.address_line1, profile.address_line2, profile.city, profile.state, profile.postal_code]
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .join(", ") || null;

  return {
    name: ctx?.tenantName ?? "",
    addressLine,
    phone: profile.phone?.trim() || null,
    // Which year the card is valid for, resolved server-side (rule 2). A card
    // about *now* has to carry the now it was true of, or it is a card with no
    // expiry that a fifteen-year-old is still holding at twenty.
    sessionName: ctx?.currentSessionName ?? null,
  };
}

type StudentRow = {
  id: string;
  admission_number: string;
  people: {
    first_name: string;
    last_name: string;
    date_of_birth: string | null;
    blood_group: string | null;
    photo_path: string | null;
    address_line1: string | null;
    city: string | null;
  } | null;
  enrolments: { roll_number: string | null; sections: { name: string; class_levels: { name: string } | null } | null }[];
  guardian_student: {
    is_primary: boolean;
    guardians: { people: { first_name: string; last_name: string; phone: string | null } | null } | null;
  }[];
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * Every card for one class, this year.
 *
 * **Session-scoped on the enrolment**, which is the whole reason this cannot be
 * a plain read of `students`: a child has one enrolment per year, and a card
 * that picked an arbitrary one would print the class they were in two years ago.
 * That is rule 2's read-side lesson, and the demo college is the only place it
 * is visible because it is the only one that has rolled a year forward.
 *
 * `SECURITY INVOKER` by construction — it is PostgREST through the caller's
 * session, no `where tenant_id`, so RLS decides which children appear. A class
 * teacher printing "their" class gets their class; an administrator gets any.
 */
export async function getIdCards(sectionId: string): Promise<CardSet> {
  const [ctx, supabase, school] = await Promise.all([
    getUserContext(),
    createClient(),
    schoolIdentity(),
  ]);

  const sessionId = ctx?.currentSessionId ?? null;

  // Rule 7: count first, refuse past the bound rather than truncating. A sheet
  // holding the first 120 of 300 children looks complete.
  let countQuery = supabase
    .from("enrolments")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId)
    .eq("status", "active");
  if (sessionId) countQuery = countQuery.eq("session_id", sessionId);
  const { count } = await countQuery;

  if ((count ?? 0) > MAX_CARDS_PER_RUN) {
    return { ok: false, reason: "too-many", count: count ?? 0 };
  }

  let query = supabase
    .from("enrolments")
    .select(
      `roll_number,
       sections ( name, class_levels ( name ) ),
       students!inner (
         id, admission_number,
         people:person_id ( first_name, last_name, date_of_birth, blood_group, photo_path,
                            address_line1, city ),
         enrolments ( roll_number, sections ( name, class_levels ( name ) ) ),
         guardian_student ( is_primary,
                            guardians ( people:person_id ( first_name, last_name, phone ) ) )
       )`,
    )
    .eq("section_id", sectionId)
    .eq("status", "active")
    .order("roll_number", { ascending: true, nullsFirst: false })
    .limit(MAX_CARDS_PER_RUN);

  if (sessionId) query = query.eq("session_id", sessionId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as {
    roll_number: string | null;
    sections: { name: string; class_levels: { name: string } | null } | null;
    students: StudentRow;
  }[];

  const cards = await Promise.all(
    rows.map(async (row) => toCard(row.students, row.roll_number, row.sections)),
  );

  return { ok: true, cards, school };
}

async function toCard(
  student: StudentRow,
  rollNumber: string | null,
  section: { name: string; class_levels: { name: string } | null } | null,
): Promise<IdCard> {
  const person = one(student.people);
  const links = student.guardian_student ?? [];
  const primary = links.find((l) => l.is_primary) ?? links[0];
  const guardianPerson = one(one(primary?.guardians)?.people);
  const level = one(section?.class_levels);

  return {
    studentId: student.id,
    fullName: person ? `${person.first_name} ${person.last_name}` : "—",
    admissionNumber: student.admission_number,
    className: section ? (level ? `${level.name} · ${section.name}` : section.name) : null,
    rollNumber,
    dateOfBirth: person?.date_of_birth ?? null,
    bloodGroup: person?.blood_group?.trim() || null,
    guardianName: guardianPerson
      ? `${guardianPerson.first_name} ${guardianPerson.last_name}`
      : null,
    guardianPhone: guardianPerson?.phone?.trim() || null,
    address: [person?.address_line1, person?.city].filter(Boolean).join(", ") || null,
    // Signed here, after the row came back through the policy. Rule 8: the
    // signature is the authorization, so a URL is only ever issued for a path
    // this caller was allowed to read.
    photoUrl: await photoUrl(person?.photo_path),
  };
}

/** One card, for the button on a student's own page. */
export async function getIdCard(
  studentId: string,
): Promise<{ card: IdCard; school: SchoolIdentity } | null> {
  const [ctx, supabase, school] = await Promise.all([
    getUserContext(),
    createClient(),
    schoolIdentity(),
  ]);

  const { data, error } = await supabase
    .from("students")
    .select(
      `id, admission_number,
       people:person_id ( first_name, last_name, date_of_birth, blood_group, photo_path,
                          address_line1, city ),
       enrolments ( roll_number, session_id, sections ( name, class_levels ( name ) ) ),
       guardian_student ( is_primary,
                          guardians ( people:person_id ( first_name, last_name, phone ) ) )`,
    )
    .eq("id", studentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const student = data as unknown as Omit<StudentRow, "enrolments"> & {
    enrolments: {
      roll_number: string | null;
      session_id: string;
      sections: { name: string; class_levels: { name: string } | null } | null;
    }[];
  };

  // The same session rule as the set, applied to one child: this year's
  // enrolment, not the first one the join happens to return.
  const enrolment =
    (student.enrolments ?? []).find((e) => e.session_id === ctx?.currentSessionId) ?? null;

  return {
    card: await toCard(
      { ...student, enrolments: [] },
      enrolment?.roll_number ?? null,
      enrolment?.sections ?? null,
    ),
    school,
  };
}
