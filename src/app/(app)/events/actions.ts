"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import type { ActionResult } from "../library/actions";

/*
 * Events (0343): the reference's "Events" (Event Title, Event Date, Total
 * Participants, Is Active). The administrator writes events and participants
 * through the policies; a family puts its own child on or off through
 * `event_join` / `event_leave`, which check the event and the date.
 */

export type EventRow = {
  id: string;
  title: string;
  eventDate: string;
  description: string | null;
  isActive: boolean;
  participants: number;
};

/**
 * This year's events and, for staff, each one's number of participants. The
 * count is of the rows the caller may read: every row for staff, which is
 * the only seat the list shows it to.
 */
export async function listEvents(): Promise<EventRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();
  let q = supabase
    .from("events")
    .select("id, title, event_date, description, is_active")
    .order("event_date", { ascending: false })
    .order("id");
  if (ctx?.currentSessionId) q = q.eq("session_id", ctx.currentSessionId);
  const [{ data, error }, parts] = await Promise.all([q, supabase.from("event_participants").select("event_id")]);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const p of parts.data ?? []) counts.set(p.event_id, (counts.get(p.event_id) ?? 0) + 1);
  return (data ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    eventDate: e.event_date,
    description: e.description,
    isActive: e.is_active,
    participants: counts.get(e.id) ?? 0,
  }));
}

/** One event by id, whatever its year: a lookup, not a list (rule 2). */
export async function getEvent(id: string): Promise<EventRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id, title, event_date, description, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const { count } = await supabase
    .from("event_participants")
    .select("id", { count: "exact", head: true })
    .eq("event_id", id);
  return {
    id: data.id,
    title: data.title,
    eventDate: data.event_date,
    description: data.description,
    isActive: data.is_active,
    participants: count ?? 0,
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function saveEvent(
  input: { title: string; eventDate: string; description: string; isActive: boolean },
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const fieldErrors: Record<string, string[]> = {};
  const title = (input?.title ?? "").trim();
  if (title.length < 1 || title.length > 150) fieldErrors.title = ["Give it a title of up to 150 characters"];
  if (!ISO.test(input?.eventDate ?? "") || Number.isNaN(Date.parse(input.eventDate))) {
    fieldErrors.eventDate = ["Pick a date"];
  }
  if ((input?.description ?? "").length > 4000) fieldErrors.description = ["At most 4,000 characters"];
  if (Object.keys(fieldErrors).length > 0) return { ok: false, error: "Check the highlighted fields.", fieldErrors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_save", {
    p_id: id ?? null,
    p_title: title,
    p_event_date: input.eventDate,
    p_description: input.description ?? "",
    p_is_active: input.isActive !== false,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/events");
  revalidatePath("/calendar");
  return { ok: true, data: { id: data as string } };
}

/** Its participants go with it: a list of who signed up is not a record anything else needs. */
export async function deleteEvent(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("events").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only an administrator can remove an event." };
  revalidatePath("/events");
  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

export type ParticipantRow = {
  id: string;
  studentId: string;
  name: string;
  admissionNumber: string;
  addedAt: string;
};

export async function listParticipants(eventId: string): Promise<ParticipantRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_participants")
    .select("id, student_id, created_at")
    .eq("event_id", eventId)
    .order("created_at")
    .order("id");
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((p) => p.student_id);
  const names = new Map<string, { name: string; admissionNumber: string }>();
  if (ids.length > 0) {
    const { data: students } = await supabase
      .from("students")
      .select("id, admission_number, people:person_id ( first_name, last_name )")
      .in("id", ids);
    for (const s of students ?? []) {
      names.set(s.id, {
        name: s.people ? `${s.people.first_name} ${s.people.last_name}` : s.admission_number,
        admissionNumber: s.admission_number,
      });
    }
  }
  return (data ?? []).map((p) => ({
    id: p.id,
    studentId: p.student_id,
    name: names.get(p.student_id)?.name ?? "—",
    admissionNumber: names.get(p.student_id)?.admissionNumber ?? "",
    addedAt: p.created_at,
  }));
}

/** The picker's search: the roll, by name or admission number (`student_search`). */
export async function searchStudentsForEvent(term: string) {
  const needle = term.trim();
  if (needle.length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_search", { p_query: needle, p_limit: 10 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({ id: s.id, name: s.full_name, admissionNumber: s.admission_number, status: s.status }));
}

export async function addParticipant(eventId: string, studentId: string): Promise<ActionResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_participants")
    .insert({ tenant_id: ctx.tenantId, event_id: eventId, student_id: studentId, added_by: ctx.userId });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That student is already taking part." };
    if (error.code === "42501") return { ok: false, error: "Only an administrator can add participants." };
    return { ok: false, error: error.message };
  }
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  return { ok: true, data: undefined };
}

export async function removeParticipant(eventId: string, participantId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("event_participants").delete().eq("id", participantId).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only an administrator can take a participant off." };
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// A family's own children

/** Which of the caller's children are on which event: their own rows, by policy. */
export async function myParticipations(): Promise<{ eventId: string; studentId: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("event_participants").select("event_id, student_id");
  return (data ?? []).map((p) => ({ eventId: p.event_id, studentId: p.student_id }));
}

export async function joinEvent(eventId: string, studentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("event_join", { p_event_id: eventId, p_student_id: studentId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/events");
  return { ok: true, data: undefined };
}

export async function leaveEvent(eventId: string, studentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("event_leave", { p_event_id: eventId, p_student_id: studentId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/events");
  return { ok: true, data: undefined };
}
