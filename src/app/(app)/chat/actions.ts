"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../library/actions";

/*
 * Chat (0350, 0351): the reference's SM Chat. Every write is a definer that
 * decides who may talk to whom; every read is the caller's own membership.
 * Nothing here filters by role or tenant: Postgres does both.
 */

export type ConversationRow = {
  id: string;
  kind: string;
  title: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
  members: number;
};

export type ChatMessage = { id: string; senderId: string; body: string; createdAt: string };
export type ChatMember = { userId: string; name: string; side: string; isMe: boolean };

export async function listConversations(): Promise<ConversationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_my_conversations");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.conversation_id,
    kind: c.kind,
    title: c.title,
    lastMessage: c.last_message,
    lastMessageAt: c.last_message_at,
    unread: c.unread,
    members: c.members,
  }));
}

/** One conversation's members and its last 200 messages, oldest first. Marks it read. */
export async function openConversation(
  conversationId: string,
): Promise<{ members: ChatMember[]; messages: ChatMessage[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return null;
  const supabase = await createClient();
  const { data: members, error } = await supabase.rpc("chat_members_of", { p_conversation_id: conversationId });
  if (error) return null;
  const { data: messages } = await supabase
    .from("chat_messages")
    .select("id, sender_id, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);
  await supabase.rpc("chat_mark_read", { p_conversation_id: conversationId });
  return {
    members: (members ?? []).map((m) => ({ userId: m.user_id, name: m.display_name, side: m.side, isMe: m.is_me })),
    messages: (messages ?? [])
      .map((m) => ({ id: m.id, senderId: m.sender_id, body: m.body, createdAt: m.created_at }))
      .reverse(),
  };
}

export async function sendMessage(conversationId: string, body: string): Promise<ActionResult> {
  const text = body.trim();
  if (!text) return { ok: false, error: "Write a message first." };
  if (text.length > 4000) return { ok: false, error: "A message is at most 4,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_send", { p_conversation_id: conversationId, p_body: text });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/chat");
  return { ok: true, data: undefined };
}

export type ReachableStudent = { id: string; name: string; admissionNumber: string; hasLogin: boolean };

export async function studentsInClass(sectionId: string): Promise<ActionResult<ReachableStudent[]>> {
  if (!/^[0-9a-f-]{36}$/i.test(sectionId)) return { ok: false, error: "Choose a class." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_reachable_in_section", { p_section_id: sectionId });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((s) => ({ id: s.student_id, name: s.full_name ?? s.admission_number, admissionNumber: s.admission_number, hasLogin: s.has_login })),
  };
}

export async function startChat(
  name: string,
  studentIds: string[],
): Promise<ActionResult<{ conversationId: string; added: number; withoutLogin: number; existing: boolean }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_start", { p_name: name.trim() || null, p_student_ids: studentIds });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { conversation_id: string; added: number; without_login: number; existing: boolean };
  revalidatePath("/chat");
  return { ok: true, data: { conversationId: r.conversation_id, added: r.added, withoutLogin: r.without_login, existing: r.existing } };
}

export type TeacherOption = { staffId: string; name: string; what: string | null; hasLogin: boolean };

export async function myTeachers(): Promise<TeacherOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("chat_my_teachers");
  return (data ?? []).map((t) => ({ staffId: t.staff_id, name: t.full_name ?? "Teacher", what: t.subjects ?? t.designation, hasLogin: t.has_login }));
}

export async function messageTeacher(staffId: string): Promise<ActionResult<{ conversationId: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_start_with_teacher", { p_staff_id: staffId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/chat");
  return { ok: true, data: { conversationId: data as string } };
}
