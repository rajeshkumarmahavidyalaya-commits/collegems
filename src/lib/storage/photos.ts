import { BUCKETS, buildObjectPath, signedUrlFor, uploadFile, type UploadResult } from "./files";
import { createClient } from "@/lib/supabase/server";

/**
 * The storage half of a person's photograph, shared by students and staff.
 *
 * **Deliberately not a shared *action*.** What these do is choreography —
 * upload, sign, delete, in the order rule 8 requires — and that is genuinely one
 * implementation. What they do *not* do is decide who may write: a student's
 * photograph is reached through `students → person_id` and a member of staff's
 * through `staff → person_id`, and those are different selects against different
 * policies. Each module asks its own question and then calls in here.
 *
 * It lived in `src/app/(app)/students/photo-actions.ts` first, and the staff
 * card sheet had to import across module boundaries to reach it — which is the
 * tell that it was in the wrong place rather than that the import was clever.
 *
 * Server-only by construction: it imports the server Supabase client, so a
 * client component importing it is a build error rather than a runtime surprise.
 */

/**
 * How long a photograph's URL lives.
 *
 * Ten minutes rather than the default hour: a card sheet is opened, checked and
 * printed, and a URL that outlives that is a bearer token for a child's
 * photograph sitting in somebody's browser history.
 */
export const PHOTO_URL_TTL_SECONDS = 600;

/** Every avatar hangs under one owner segment — staff and students alike are people. */
export const PHOTO_OWNER = "people";

/**
 * A short-lived URL for one photograph, or null.
 *
 * **Call this only after the row has been read back through RLS** — rule 8 says
 * the signature *is* the authorization, so it must never run on a path that came
 * from anywhere but a select the caller was allowed to make.
 *
 * For more than one, use `photoUrls`.
 */
export async function photoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  return signedUrlFor(BUCKETS.avatars, path, PHOTO_URL_TTL_SECONDS);
}

/**
 * Signed URLs for a whole set, in one round trip.
 *
 * The first ID-card sheet mapped `photoUrl` over forty children, which is forty
 * server clients and forty HTTP requests to Storage to render one page.
 * CLAUDE.md already names that mistake in SQL — *"a scalar function that queries
 * another table is a correlated subquery wearing a nicer name… resolve a set as
 * a set"* — where `audit_actor_label` cost 8.4 ms a row.
 *
 * Returns a **map** rather than an array, so a path that failed to sign is
 * simply absent rather than shifting every later person by one.
 */
export async function photoUrls(
  paths: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKETS.avatars)
    .createSignedUrls(wanted, PHOTO_URL_TTL_SECONDS);

  if (error) {
    console.error("[storage] could not sign avatars:", error.message);
    return out;
  }

  for (const row of data ?? []) {
    // A per-object failure is reported on its own row rather than failing the
    // batch, so one deleted file does not blank a whole class's cards.
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
  }
  return out;
}

/** Upload an avatar for a tenant. The caller has already checked *whose* it is. */
export async function uploadPersonPhoto(
  tenantId: string,
  file: File,
): Promise<UploadResult> {
  return uploadFile(BUCKETS.avatars, tenantId, PHOTO_OWNER, file);
}

/** Remove an object, best effort. An orphaned object costs bytes nobody sees. */
export async function deletePhotoObject(path: string): Promise<void> {
  const supabase = await createClient();
  await supabase.storage.from(BUCKETS.avatars).remove([path]);
}

export { buildObjectPath };

/**
 * The **bytes** of one photograph, for a renderer that has to embed it.
 *
 * A URL is for a browser. A PDF has no browser: it embeds the image, so it needs
 * the object itself — and minting a signed URL in order to fetch bytes the
 * server could read directly is signing something nobody asked for, which is
 * exactly what rule 8's *"never render a signed link into a page"* is about one
 * step along. It is also a round trip through the CDN to reach an object this
 * process can open.
 *
 * **Call this only after the row has been read back through RLS**, on the same
 * terms as `photoUrl`: the path is addressing, and the select is the
 * authorization.
 *
 * Returns null rather than throwing on a missing object, because a photograph
 * that has gone missing is a card that cannot be printed — a sentence for the
 * office — and not a server error.
 */
export async function photoBytes(
  path: string | null | undefined,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKETS.avatars).download(path);
  if (error || !data) return null;
  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    // Supabase returns the stored object's own type; the `avatars` bucket only
    // admits jpeg, png and webp, and the renderer refuses the third by name.
    contentType: data.type || "application/octet-stream",
  };
}
