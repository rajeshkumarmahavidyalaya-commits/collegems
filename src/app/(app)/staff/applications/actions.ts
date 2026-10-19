"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../../library/actions";

/*
 * Staff applications sent from the college's public page (0361). The policies
 * decide who reads and decides them (whoever holds staff.manage); the column
 * grant keeps what the applicant wrote as they wrote it.
 */

export type ApplicationStatus = "new" | "shortlisted" | "rejected" | "hired";
const APPLICATION_STATUSES: ApplicationStatus[] = ["new", "shortlisted", "rejected", "hired"];

export type ApplicationRow = {
  id: string;
  createdAt: string;
  name: string;
  position: string;
  qualification: string | null;
  experienceYears: number | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  message: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  staffId: string | null;
};

const PAGE = 200;

export async function listApplications(
  status: ApplicationStatus,
): Promise<{ rows: ApplicationRow[]; total: number; counts: Record<ApplicationStatus, number> }> {
  const supabase = await createClient();
  const [res, ...countRes] = await Promise.all([
    supabase
      .from("staff_applications")
      .select(
        "id, created_at, first_name, last_name, position, qualification, experience_years, phone, email, city, message, decision_note, decided_at, staff_id",
        { count: "exact" },
      )
      .eq("status", status)
      // Oldest first while somebody still has to decide, newest first after.
      .order("created_at", { ascending: status === "new" || status === "shortlisted" })
      .order("id")
      .limit(PAGE),
    ...APPLICATION_STATUSES.map((s) =>
      supabase.from("staff_applications").select("id", { count: "exact", head: true }).eq("status", s),
    ),
  ]);
  if (res.error) throw new Error(res.error.message);
  const counts = Object.fromEntries(APPLICATION_STATUSES.map((s, i) => [s, countRes[i].count ?? 0])) as Record<
    ApplicationStatus,
    number
  >;
  return {
    total: res.count ?? 0,
    counts,
    rows: (res.data ?? []).map((a) => ({
      id: a.id,
      createdAt: a.created_at,
      name: [a.first_name, a.last_name].filter(Boolean).join(" "),
      position: a.position,
      qualification: a.qualification,
      experienceYears: a.experience_years,
      phone: a.phone,
      email: a.email,
      city: a.city,
      message: a.message,
      decisionNote: a.decision_note,
      decidedAt: a.decided_at,
      staffId: a.staff_id,
    })),
  };
}

/**
 * Shortlist, turn down or reopen. Hiring is not here: it is the add-staff
 * form, which links the application to the record it makes.
 */
export async function decideApplication(
  id: string,
  status: "new" | "shortlisted" | "rejected",
  note?: string,
): Promise<ActionResult> {
  const reason = (note ?? "").trim();
  if (status === "rejected" && reason.length < 3) {
    return { ok: false, error: "Say why, so the office remembers when the same person applies again." };
  }
  if (reason.length > 500) return { ok: false, error: "Keep the note under 500 characters." };
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Sign in again." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_applications")
    .update({
      status,
      decision_note: status === "new" ? null : reason || null,
      decided_by: status === "new" ? null : ctx.userId,
      decided_at: status === "new" ? null : new Date().toISOString(),
    })
    .eq("id", id)
    .neq("status", "hired")
    .select("id");
  if (error) return { ok: false, error: error.message };
  // An update no policy matches writes nothing and raises nothing (rule 6).
  if (!data || data.length !== 1) {
    return { ok: false, error: "That application could not be changed. It may have been hired already, or your role may not decide applications." };
  }
  revalidatePath("/staff/applications");
  return { ok: true, data: undefined };
}
