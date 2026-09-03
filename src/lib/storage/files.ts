import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { BUCKET_LIMITS, safeFileName, type BucketId } from "./constants";

/**
 * The project's one way in and out of Supabase Storage.
 *
 * Server-only, and enforced rather than asserted: it imports
 * `@/lib/supabase/server`, which reads `next/headers` and cannot be bundled into
 * a client component. Importing this from the browser is a build error, not a
 * runtime surprise.
 *
 * Rule 8: private buckets only, the object *path* in the database, never a
 * public URL, and every read through a signed URL issued after a server-side
 * permission check.
 *
 * The split of responsibility is worth stating once, because it is not obvious
 * and every later upload copies it:
 *
 *   Storage RLS   sees the path and nothing else, so it enforces the one rule a
 *                 path can carry — the first segment is the tenant. Coarse, but
 *                 absolute: no object in another school's folder is reachable.
 *   This module   is called only after the caller's server action has checked
 *                 the row-level question ("is this the student's own
 *                 submission?") against `public`, which is where the answer
 *                 lives.
 *
 * Neither half is sufficient alone, and the storage half is the one that still
 * holds if the other is forgotten.
 *
 * The bucket names and limits live in `./constants`, which has no server
 * imports, so an upload control can state the limit before a person picks a
 * 40 MB file without dragging the server client into the browser bundle. They
 * are re-exported from here so callers have one import to remember.
 */

/**
 * `{tenant_id}/{owner_id}/{uuid}-{name}`.
 *
 * The first segment is load-bearing — `storage_object_tenant_matches()` compares
 * it to the JWT's tenant. Everything below it is addressing, not security: a
 * person who guesses a colleague's homework id inside their own school is
 * stopped by the server action, not by the path.
 *
 * The uuid prefix means two people uploading `answers.jpg` to the same
 * submission do not collide, and it makes the object unguessable — which
 * matters because a signed URL is bearer-only once issued.
 */
export function buildObjectPath(tenantId: string, ownerId: string, fileName: string): string {
  return `${tenantId}/${ownerId}/${randomUUID()}-${safeFileName(fileName)}`;
}

export type UploadResult =
  | { ok: true; path: string; fileName: string; contentType: string; size: number }
  | { ok: false; error: string };

/**
 * Upload through the caller's own session, so storage RLS applies to them
 * rather than to a service role. The bucket's declared limits are re-checked
 * here for the sake of the message: Supabase's own refusal is a 413 with no
 * useful body, and somebody who has just waited for a 30 MB upload deserves to
 * be told what the limit was.
 */
export async function uploadFile(
  bucket: BucketId,
  tenantId: string,
  ownerId: string,
  file: File,
): Promise<UploadResult> {
  const limits = BUCKET_LIMITS[bucket];

  if (file.size === 0) {
    return { ok: false, error: "That file is empty." };
  }
  if (file.size > limits.maxBytes) {
    const mb = Math.round(limits.maxBytes / (1024 * 1024));
    return {
      ok: false,
      error: `That file is larger than the ${mb} MB limit for this kind of upload.`,
    };
  }
  if (file.type && !limits.accept.includes(file.type)) {
    return { ok: false, error: `${file.type} files are not accepted here.` };
  }

  const path = buildObjectPath(tenantId, ownerId, file.name);
  const supabase = await createClient();

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    // Never overwrite: the uuid makes a collision impossible, so an upsert
    // could only ever mask a bug.
    upsert: false,
  });

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    path,
    fileName: safeFileName(file.name),
    contentType: file.type || "application/octet-stream",
    size: file.size,
  };
}

/**
 * A short-lived URL for one object. **Call this only after checking that the
 * caller may see the row the object hangs off** — the signature *is* the
 * authorization, so issuing one is the same as handing the file over.
 *
 * Ten minutes: long enough to click, short enough that a link pasted into a
 * group chat stops working before it travels.
 */
export async function signedUrlFor(
  bucket: BucketId,
  path: string,
  expiresInSeconds = 600,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error) {
    console.error("[storage] could not sign", bucket, path, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** Force a download rather than an inline render, for anything that is not an image. */
export async function signedDownloadUrlFor(
  bucket: BucketId,
  path: string,
  fileName: string,
  expiresInSeconds = 600,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds, { download: safeFileName(fileName) });

  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Remove an object. The database row is the record of what exists, so callers
 * delete the row *after* this succeeds — an orphaned object costs storage, an
 * orphaned row costs a broken download.
 */
export async function removeFile(bucket: BucketId, path: string): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    console.error("[storage] could not remove", bucket, path, error.message);
    return false;
  }
  return true;
}

export { BUCKETS, BUCKET_LIMITS, safeFileName, formatBytes } from "./constants";
export type { BucketId } from "./constants";
