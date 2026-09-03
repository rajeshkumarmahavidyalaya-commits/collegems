/**
 * The parts of the storage contract that a browser is allowed to know: which
 * buckets exist, what each will accept, and how to render a size.
 *
 * Split out of `files.ts` deliberately. That module imports the server Supabase
 * client, so importing it from a client component is a build error — which is
 * the property that keeps uploads server-side. But an upload control still has
 * to tell a person the limit *before* they pick a 40 MB file, and the honest
 * way to do that is to share the numbers, not to duplicate them. One
 * definition, imported by both halves.
 */

export const BUCKETS = {
  avatars: "avatars",
  documents: "documents",
  studyMaterial: "study-material",
  homeworkSubmissions: "homework-submissions",
} as const;

export type BucketId = (typeof BUCKETS)[keyof typeof BUCKETS];

/** Mirrors `storage.buckets.file_size_limit` and its MIME list from migration 0053. */
export const BUCKET_LIMITS: Record<BucketId, { maxBytes: number; accept: string[] }> = {
  "avatars": {
    maxBytes: 5 * 1024 * 1024,
    accept: ["image/jpeg", "image/png", "image/webp"],
  },
  "documents": {
    maxBytes: 10 * 1024 * 1024,
    accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  },
  "study-material": {
    maxBytes: 50 * 1024 * 1024,
    accept: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "application/zip",
    ],
  },
  "homework-submissions": {
    maxBytes: 20 * 1024 * 1024,
    accept: ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"],
  },
};

/**
 * Strip everything from a filename that could change what a path means.
 *
 * A name is only ever the *last* segment of a path, so a `../` or an embedded
 * slash would move the object somewhere the tenant prefix no longer describes —
 * and the tenant prefix is the whole of the storage-side security. This is why
 * the name is rebuilt rather than trusted, even though Supabase would probably
 * reject it anyway: "probably" is not a boundary.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || "file";
}

/** `1.4 MB`. Bytes are not a unit anybody reads. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
