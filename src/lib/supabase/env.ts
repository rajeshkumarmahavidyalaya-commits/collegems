/**
 * Next.js inlines `NEXT_PUBLIC_*` at BUILD time, so these must be present in
 * the environment that runs `next build` -- not just at runtime. When they are
 * missing, supabase-js fails deep inside client construction with a generic
 * "URL and Key are required" that surfaces as an opaque 500 on every route
 * (middleware builds a client before any page renders). These accessors fail
 * with something you can act on instead.
 *
 * Read lazily rather than at module load so a build without the values still
 * completes -- the error should point at the deployment, not break `next build`
 * for someone who only wants to typecheck.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is missing from the build environment. NEXT_PUBLIC_* values are ` +
        `inlined at build time, so setting it only at runtime will not help: add ` +
        `it in your host's environment variables (Vercel: Project → Settings → ` +
        `Environment Variables) and redeploy so the app is rebuilt with it.`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Supabase's newer "publishable key" and its legacy "anon key" are the same
 * thing as far as this app is concerned: a public, RLS-gated client key. The
 * Vercel Supabase integration injects the legacy name, while a hand-configured
 * project usually gets the newer one -- so accept whichever is present rather
 * than forcing one convention on the deployment.
 *
 * Both must be referenced as literal `process.env.X` for Next.js to inline them.
 */
export function supabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
