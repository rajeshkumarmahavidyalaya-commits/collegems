"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { photoUrl, photoUrls } from "@/lib/storage/photos";
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
 * Roll order, which Postgres cannot give us here.
 *
 * `enrolments.roll_number` is **text**, so `order by roll_number` returns
 * 1, 10, 11, 2, 3 — and a sheet of cards handed out in roll order is exactly
 * where that is noticed. Text is the right column type: plenty of schools use
 * `12A` or `VI-07`.
 *
 * `Intl.Collator` with `numeric: true` reads the digit runs inside the string,
 * so `2` precedes `10` and `VI-7` precedes `VI-10`. The locale is pinned to
 * `en` **on purpose** and this is not the hardcoded-locale-tag mistake rule 15
 * names: a roll number is an identifier, not a word, and the order a class is
 * called in must not change depending on who printed the sheet. Same reasoning
 * that keeps `audit.fieldLabel` untranslated.
 *
 * A child with no roll number sorts last rather than first — an unnumbered card
 * at the top of the pile looks like the pile is in no order at all.
 */
const ROLL_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function byRoll(a: IdCard, b: IdCard): number {
  if (!a.rollNumber && !b.rollNumber) return a.fullName.localeCompare(b.fullName);
  if (!a.rollNumber) return 1;
  if (!b.rollNumber) return -1;
  return ROLL_COLLATOR.compare(a.rollNumber, b.rollNumber);
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
         guardian_student ( is_primary,
                            guardians ( people:person_id ( first_name, last_name, phone ) ) )
       )`,
    )
    .eq("section_id", sectionId)
    .eq("status", "active")
    .limit(MAX_CARDS_PER_RUN);

  if (sessionId) query = query.eq("session_id", sessionId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as {
    roll_number: string | null;
    sections: { name: string; class_levels: { name: string } | null } | null;
    students: StudentRow;
  }[];

  // One request to Storage for every photograph, not one per child. Mapping the
  // single-path signer over forty students meant forty server clients and forty
  // HTTP round trips to render one page — CLAUDE.md's *"resolve a set as a set"*
  // in TypeScript.
  const signed = await photoUrls(rows.map((r) => one(r.students.people)?.photo_path));

  const cards = rows
    .map((row) => toCard(row.students, row.roll_number, row.sections, signed))
    .sort(byRoll);

  return { ok: true, cards, school };
}

function toCard(
  student: StudentRow,
  rollNumber: string | null,
  section: { name: string; class_levels: { name: string } | null } | null,
  signed: Map<string, string>,
): IdCard {
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
    // Looked up from the batch signed above, after the rows came back through
    // the policy. Rule 8: the signature is the authorization, so a URL is only
    // ever issued for a path this caller was allowed to read.
    photoUrl: (person?.photo_path && signed.get(person.photo_path)) || null,
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

  // One child, so one signature: the set version would be a batch of one.
  const path = one(student.people)?.photo_path ?? null;
  const url = await photoUrl(path);
  const signed = new Map(path && url ? [[path, url]] : []);

  return {
    card: toCard(
      { ...student, enrolments: [] },
      enrolment?.roll_number ?? null,
      enrolment?.sections ?? null,
      signed,
    ),
    school,
  };
}
