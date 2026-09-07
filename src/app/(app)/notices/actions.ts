"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  BUCKETS,
  removeFile,
  signedDownloadUrlFor,
  uploadFile,
} from "@/lib/storage/files";
import {
  noticeAudienceJson,
  noticeSchema,
  parseReadSummary,
  publishResultSchema,
  withdrawSchema,
  type PublishResult,
  type ReadSummary,
} from "@/lib/validations/notices";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type BoardRow = {
  id: string;
  title: string;
  body: string;
  category: string;
  isPinned: boolean;
  publishedAt: string | null;
  startsOn: string | null;
  expiresOn: string | null;
  status: string;
  attachments: number;
  isRead: boolean;
};

export async function getBoard(limit = 50): Promise<BoardRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("notice_board", { p_limit: limit });

  return (data ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    category: n.category,
    isPinned: n.is_pinned,
    publishedAt: n.published_at,
    startsOn: n.starts_on,
    expiresOn: n.expires_on,
    status: n.status,
    attachments: n.attachments,
    isRead: n.is_read,
  }));
}

/** Drafts and withdrawn ones too — the writer's view, not the reader's. */
export async function listAllNotices() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notices")
    .select(
      "id, title, category, audience, status, is_pinned, published_at, announced_count, last_announce_error, starts_on, expires_on, withdraw_reason",
    )
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(100);
  return data ?? [];
}

export async function getNotice(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notices")
    .select(
      "id, title, body, category, audience, status, is_pinned, published_at, starts_on, expires_on, announced_count, last_announced_at, last_announce_error, withdraw_reason, withdrawn_at",
    )
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function listAttachments(noticeId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notice_files")
    .select("id, file_name, content_type, size_bytes, storage_path")
    .eq("notice_id", noticeId)
    .order("created_at");
  return data ?? [];
}

/**
 * A link for one attachment, issued on demand.
 *
 * Never rendered into the page: the row is read back through RLS *first*, and
 * only then is a URL signed. Rule 8 — the signature is the authorization, so
 * signing one before anybody asked is the same as publishing the file. A notice
 * withdrawn this morning stops producing links this morning, because the select
 * below returns nothing.
 */
export async function attachmentUrl(fileId: string): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notice_files")
    .select("storage_path, file_name")
    .eq("id", fileId)
    .maybeSingle();

  if (!data) return { ok: false, error: "That attachment is no longer available." };

  const url = await signedDownloadUrlFor(BUCKETS.documents, data.storage_path, data.file_name);
  if (!url) return { ok: false, error: "The link could not be created." };
  return { ok: true, data: { url } };
}

export async function saveNotice(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = noticeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Sign in again." };
  if (!ctx.currentSessionId) {
    return { ok: false, error: "There is no current academic session to post against." };
  }

  const supabase = await createClient();
  const row = {
    title: parsed.data.title,
    body: parsed.data.body,
    category: parsed.data.category,
    audience: noticeAudienceJson(parsed.data.audience),
    is_pinned: parsed.data.isPinned,
    starts_on: parsed.data.startsOn || null,
    expires_on: parsed.data.expiresOn || null,
  };

  if (parsed.data.id) {
    // Editing never announces. There is no trigger, and there is no call here.
    const { error } = await supabase.from("notices").update(row).eq("id", parsed.data.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/notices");
    revalidatePath(`/notices/${parsed.data.id}`);
    return { ok: true, data: { id: parsed.data.id } };
  }

  const { data, error } = await supabase
    .from("notices")
    .insert({ ...row, tenant_id: ctx.tenantId, session_id: ctx.currentSessionId })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/notices");
  return { ok: true, data: { id: data.id } };
}

export async function publishNotice(id: string): Promise<ActionResult<PublishResult>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notice_publish", { p_notice_id: id });
  if (error) return { ok: false, error: error.message };

  const parsed = publishResultSchema.safeParse(data);
  if (!parsed.success) return { ok: false, error: "The publish came back in an unexpected shape." };

  revalidatePath("/notices");
  revalidatePath(`/notices/${id}`);
  return { ok: true, data: parsed.data };
}

/** Deliberately separate from publishing. See `docs/modules/notices.md`. */
export async function announceAgain(id: string): Promise<ActionResult<{ announced: boolean; error?: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notice_announce", { p_notice_id: id });
  if (error) return { ok: false, error: error.message };

  const result = data as { announced: boolean; error: string | null };
  revalidatePath(`/notices/${id}`);
  return { ok: true, data: { announced: result.announced, error: result.error ?? undefined } };
}

export async function withdrawNotice(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = withdrawSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("notice_withdraw", {
    p_notice_id: parsed.data.noticeId,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/notices");
  revalidatePath(`/notices/${parsed.data.noticeId}`);
  return { ok: true, data: { id: parsed.data.noticeId } };
}

/**
 * "I have seen this."
 *
 * Called when the detail page renders, not from a button: a read receipt that
 * needs a click measures who pressed a button, which is a different and much
 * less useful fact than who opened the circular.
 */
export async function markRead(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("notice_mark_read", { p_notice_id: id });
}

export async function readSummary(id: string): Promise<ReadSummary | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("notice_read_summary", { p_notice_id: id });
  return parseReadSummary(data);
}

/**
 * Attach a file.
 *
 * Object first, row second, and the object is deleted if the row fails — rule
 * 8's "orphans have a direction". An orphaned object costs bytes nobody sees;
 * an orphaned row is a broken download on somebody's screen.
 */
export async function attachFile(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const noticeId = String(formData.get("noticeId") ?? "");
  const file = formData.get("file");

  if (!noticeId) return { ok: false, error: "Which notice?" };
  if (!(file instanceof File)) return { ok: false, error: "Choose a file." };

  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Sign in again." };

  const uploaded = await uploadFile(BUCKETS.documents, ctx.tenantId, noticeId, file);
  if (!uploaded.ok) return { ok: false, error: uploaded.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notice_files")
    .insert({
      tenant_id: ctx.tenantId,
      notice_id: noticeId,
      storage_path: uploaded.path,
      bucket_id: BUCKETS.documents,
      file_name: uploaded.fileName,
      content_type: uploaded.contentType,
      size_bytes: uploaded.size,
      uploaded_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    await removeFile(BUCKETS.documents, uploaded.path);
    return { ok: false, error: error.message };
  }

  revalidatePath(`/notices/${noticeId}`);
  return { ok: true, data: { id: data.id } };
}

/** On delete, the object goes first — while the path is still readable. */
export async function removeAttachment(fileId: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notice_files")
    .select("id, notice_id, storage_path")
    .eq("id", fileId)
    .maybeSingle();

  if (!data) return { ok: false, error: "That attachment is already gone." };

  await removeFile(BUCKETS.documents, data.storage_path);

  const { error } = await supabase.from("notice_files").delete().eq("id", fileId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/notices/${data.notice_id}`);
  return { ok: true, data: { id: fileId } };
}
