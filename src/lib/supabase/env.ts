/**
 * Which Supabase project this app talks to.
 *
 * Both values are PUBLIC by design: `NEXT_PUBLIC_*` is inlined into the client
 * bundle, so the anon/publishable key ships to every browser either way. Row
 * Level Security in Postgres is the security boundary -- not the secrecy of
 * this key. The service_role key, which bypasses RLS, is never referenced here
 * and must never be.
 *
 * These are committed rather than left purely to host configuration because
 * `NEXT_PUBLIC_*` is inlined at BUILD time. A host that builds without them
 * produces an app that is broken in a way no runtime configuration can repair,
 * and the failure surfaces as an opaque 500 on every route -- middleware
 * constructs a Supabase client before any page renders. Shipping a working
 * default makes `git push` sufficient to deploy.
 *
 * To point at a different Supabase project, set NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (or ..._PUBLISHABLE_KEY) in the build
 * environment; a valid, self-consistent pair overrides what is below. When
 * this app grows past one Supabase project, delete these constants and make
 * the environment the only source.
 */
const FALLBACK_URL = "https://bbwdkglcndaoiqmzdliq.supabase.co";
const FALLBACK_KEY = "sb_publishable_k2-zXIM3q6Kyeo2-3VXRUQ_qr-mHF86";

/** Project ref out of a `https://<ref>.supabase.co` URL. */
function refFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\./i);
  return match ? match[1] : null;
}

/**
 * Project ref out of a legacy anon key (a JWT carrying `ref` in its payload).
 * Newer publishable keys are opaque, so this returns null for them -- absence
 * of a ref is not a mismatch, only two *known* differing refs are.
 */
function refFromKey(key: string | undefined): string | null {
  if (!key) return null;
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    return typeof payload?.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}

/**
 * Environment values are used only as a complete, self-consistent pair.
 *
 * A URL from one project with a key from another cannot authenticate, and it
 * is the exact shape a half-finished dashboard edit or a marketplace
 * integration pointing at the wrong project leaves behind. Silently honouring
 * that mismatch produces confusing auth failures; falling back to a pair known
 * to belong together does not.
 */
export type SupabaseConfig = {
  url: string;
  key: string;
  /** Where the values came from -- surfaced by /api/health for diagnosis. */
  source: "environment" | "fallback:absent" | "fallback:mismatch";
  projectRef: string | null;
};

export function resolveSupabaseConfig(): SupabaseConfig {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const envKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!envUrl || !envKey) {
    return {
      url: FALLBACK_URL,
      key: FALLBACK_KEY,
      source: "fallback:absent",
      projectRef: refFromUrl(FALLBACK_URL),
    };
  }

  const urlRef = refFromUrl(envUrl);
  const keyRef = refFromKey(envKey);

  if (urlRef && keyRef && urlRef !== keyRef) {
    console.warn(
      `[supabase] NEXT_PUBLIC_SUPABASE_URL points at project "${urlRef}" but the ` +
        `configured key belongs to "${keyRef}". Ignoring both and using the ` +
        `built-in defaults. Fix the pair in your host's environment variables.`,
    );
    return {
      url: FALLBACK_URL,
      key: FALLBACK_KEY,
      source: "fallback:mismatch",
      projectRef: refFromUrl(FALLBACK_URL),
    };
  }

  return { url: envUrl, key: envKey, source: "environment", projectRef: urlRef };
}

export function supabaseUrl(): string {
  return resolveSupabaseConfig().url;
}

export function supabasePublishableKey(): string {
  return resolveSupabaseConfig().key;
}
