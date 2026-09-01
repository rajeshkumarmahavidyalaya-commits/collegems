import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Deployment health/introspection endpoint.
 *
 * NEXT_PUBLIC_* values are inlined at build time, which makes "what does the
 * running build actually have?" surprisingly hard to answer from outside --
 * a stale build cache or a variable set after the fact both look identical
 * from the browser. This reports what was compiled in, so a misconfigured
 * deployment can be diagnosed with one request instead of reading build logs.
 *
 * Everything here is already public: the project URL and the anon/publishable
 * key ship in the client bundle by design, and RLS is the security boundary.
 * The key itself is still never echoed -- only whether it exists and which
 * project it belongs to, which is what actually matters when diagnosing.
 */
function projectRefFromKey(key: string | undefined): string | null {
  if (!key) return null;
  // Newer publishable keys are opaque; legacy anon keys are JWTs whose
  // payload carries the project ref.
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

function refFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\./i);
  return match ? match[1] : null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const urlRef = refFromUrl(url);
  const keyRef = projectRefFromKey(key);

  return NextResponse.json({
    supabaseUrl: url ?? null,
    supabaseUrlProjectRef: urlRef,
    supabaseKeyPresent: Boolean(key),
    supabaseKeyProjectRef: keyRef,
    // A key issued by a different project than the URL points at will fail
    // to authenticate, and is easy to end up with when switching projects.
    urlAndKeyAgree: urlRef !== null && keyRef !== null ? urlRef === keyRef : null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    builtAt: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  });
}
