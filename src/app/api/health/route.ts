import { NextResponse } from "next/server";
import { resolveSupabaseConfig } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/**
 * Deployment health/introspection endpoint.
 *
 * NEXT_PUBLIC_* values are inlined at build time, which makes "what is the
 * running build actually configured with?" hard to answer from outside -- a
 * stale build cache and a variable set after the build look identical in the
 * browser. This reports the *effective* configuration, so a misconfigured
 * deployment can be diagnosed with one request instead of reading build logs.
 *
 * The project URL is public by design (it ships in the client bundle), and the
 * key itself is never echoed -- only which project it belongs to, which is
 * what matters when diagnosing a wrong-project mixup.
 */
export async function GET() {
  const config = resolveSupabaseConfig();

  return NextResponse.json({
    supabaseUrl: config.url,
    supabaseProjectRef: config.projectRef,
    // "environment"       -> a valid pair came from the host
    // "fallback:absent"   -> host set nothing; using built-in defaults
    // "fallback:mismatch" -> host's URL and key were from different projects
    configSource: config.source,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  });
}
