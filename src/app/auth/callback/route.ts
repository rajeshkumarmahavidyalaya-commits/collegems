import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validations/password";

/**
 * Where an emailed sign-in link lands (0289): today, a password reset.
 *
 * Two shapes, because Supabase sends either depending on the email template:
 * `?code=` for the PKCE flow `resetPasswordForEmail` starts from a server
 * action, and `?token_hash=&type=` when a college's template links there
 * directly. Either way the session is set in cookies here and the person goes
 * on to `next` -- only ever an in-app path, so a crafted link cannot bounce
 * somebody to another site.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();
  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }

  if (ok) return NextResponse.redirect(new URL(next, url.origin));
  const failed = next.startsWith("/auth/reset") ? "/auth/reset?expired=1" : "/login";
  return NextResponse.redirect(new URL(failed, url.origin));
}
