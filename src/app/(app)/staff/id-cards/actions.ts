"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { photoUrls } from "@/lib/storage/photos";
import { MAX_CARDS_PER_RUN, type SchoolIdentity, type StaffCard } from "@/lib/validations/id-card";

export type StaffCardSet =
  | { ok: true; cards: StaffCard[]; departments: string[]; school: SchoolIdentity }
  | { ok: false; reason: "withheld" }
  | { ok: false; reason: "too-many"; count: number };

type ProfileRow = {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  phone?: string | null;
};

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
    sessionName: ctx?.currentSessionName ?? null,
  };
}

/**
 * Cards for everybody currently employed, optionally one department.
 *
 * **The permission check is here, and it is not decoration.** A student card
 * needs none beyond the page's `students.view`, because RLS on `students` is
 * *row-ownership*: a class teacher printing "their" class is narrowed to their
 * own children by the policy, which is the right answer and needs nothing else
 * to produce it.
 *
 * RLS on `staff` is **role-wide** — admin, teacher, accountant and librarian
 * each read every row — so the policy narrows nothing, and *"an accountant may
 * not pull the staff roster"* is a rule only `role_permissions` expresses. That
 * is rule 4's refinement exactly, and `staff_roster` already makes the same
 * check *inside the function that produces the data*.
 *
 * This cannot simply call `staff_roster`, which is the tidy answer and the
 * wrong one: the roster does not return `photo_path`, and a card without a
 * photograph is not a card. So it reads the tables and **repeats the gate**
 * rather than inheriting it — the thing to notice being that skipping it would
 * have been invisible, because the rows come back either way.
 */
export async function getStaffCards(department?: string): Promise<StaffCardSet> {
  const [canView, supabase, school] = await Promise.all([
    hasPermission("staff.view"),
    createClient(),
    schoolIdentity(),
  ]);

  if (!canView) return { ok: false, reason: "withheld" };

  // Only people who are here. A departed teacher's card is a door that should
  // not open, which is `student_exit`'s lesson pointed at a badge.
  let countQuery = supabase
    .from("staff")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  if (department) countQuery = countQuery.eq("department", department);
  const { count } = await countQuery;

  if ((count ?? 0) > MAX_CARDS_PER_RUN) {
    return { ok: false, reason: "too-many", count: count ?? 0 };
  }

  let query = supabase
    .from("staff")
    .select(
      `id, employee_code, designation, department,
       people:person_id ( first_name, last_name, phone, blood_group, photo_path )`,
    )
    .eq("status", "active")
    .limit(MAX_CARDS_PER_RUN);
  if (department) query = query.eq("department", department);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    employee_code: string;
    designation: string;
    department: string | null;
    people: {
      first_name: string;
      last_name: string;
      phone: string | null;
      blood_group: string | null;
      photo_path: string | null;
    } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  // One request for every photograph, per the fix the student sheet already
  // took: a scalar signer mapped over a set is a correlated subquery wearing a
  // nicer name.
  const signed = await photoUrls(rows.map((r) => r.people?.photo_path));

  const cards: StaffCard[] = rows
    .map((row) => ({
      staffId: row.id,
      fullName: row.people ? `${row.people.first_name} ${row.people.last_name}` : "—",
      employeeCode: row.employee_code,
      designation: row.designation,
      department: row.department?.trim() || null,
      phone: row.people?.phone?.trim() || null,
      bloodGroup: row.people?.blood_group?.trim() || null,
      photoUrl: (row.people?.photo_path && signed.get(row.people.photo_path)) || null,
    }))
    // Employee codes are text for the same reason roll numbers are, so the same
    // numeric-aware comparator applies. Pinned to `en`: a code is an identifier,
    // and the order a pile of cards comes out in must not depend on the reader.
    .sort((a, b) => CODE_COLLATOR.compare(a.employeeCode, b.employeeCode));

  const departments = [...new Set(cards.map((c) => c.department).filter((d): d is string => !!d))]
    .sort((a, b) => a.localeCompare(b));

  return { ok: true, cards, departments, school };
}

const CODE_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** One card, for the button on a member of staff's own page. */
export async function getStaffCard(
  staffId: string,
): Promise<{ card: StaffCard; school: SchoolIdentity } | null> {
  const [canView, supabase, school] = await Promise.all([
    hasPermission("staff.view"),
    createClient(),
    schoolIdentity(),
  ]);
  if (!canView) return null;

  const { data, error } = await supabase
    .from("staff")
    .select(
      `id, employee_code, designation, department,
       people:person_id ( first_name, last_name, phone, blood_group, photo_path )`,
    )
    .eq("id", staffId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as unknown as {
    id: string;
    employee_code: string;
    designation: string;
    department: string | null;
    people: {
      first_name: string;
      last_name: string;
      phone: string | null;
      blood_group: string | null;
      photo_path: string | null;
    } | null;
  };

  const signed = await photoUrls([row.people?.photo_path]);

  return {
    card: {
      staffId: row.id,
      fullName: row.people ? `${row.people.first_name} ${row.people.last_name}` : "—",
      employeeCode: row.employee_code,
      designation: row.designation,
      department: row.department?.trim() || null,
      phone: row.people?.phone?.trim() || null,
      bloodGroup: row.people?.blood_group?.trim() || null,
      photoUrl: (row.people?.photo_path && signed.get(row.people.photo_path)) || null,
    },
    school,
  };
}
