import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

// /api/health must stay reachable without a session -- it exists to diagnose
// deployments that cannot authenticate in the first place.
const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/api/health"];

/**
 * Signed in, but belonging to no school yet.
 *
 * Rule 3 leaves a signup with no matching invitation without a tenant, and
 * calls that "the correct failure mode" — which it is, for the data: RLS then
 * denies everything. It is not a mode a *person* can be left in, because every
 * screen in the product reads a tenant from the JWT and comes back empty.
 *
 * `/start` is where that person goes, and it is deliberately not in
 * PUBLIC_PATHS: it needs a session, it just does not need a school.
 */
const TENANTLESS_PATH = "/start";

/** Not an error: "this request has no session and never claimed to". */
class SignedOut extends Error {}

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Whether this request carries anything that could be a session.
 *
 * Supabase's cookie-based auth stores the session under `sb-<ref>-auth-token`,
 * chunked across `.0`, `.1`, ... when it is long. If none of those is present
 * there is nothing to refresh and nothing to validate, so calling
 * `auth.getUser()` would be a network round trip to Supabase whose only
 * possible answer is "no user".
 *
 * That call was happening on **every request from every signed-out visitor**,
 * in front of every route, before they could be redirected to /login. Skipping
 * it removes a round trip from the slowest path a new user has — the first one.
 *
 * Deliberately a prefix test rather than the exact project-scoped name: the
 * project ref is part of the cookie name, and a middleware that has to parse
 * the Supabase URL to know what to look for is a middleware that breaks when
 * the URL is missing — which is exactly the failure the try/catch below exists
 * to survive. A false positive here costs one round trip and is then handled
 * normally; a false negative would sign somebody out, so the test is
 * deliberately generous.
 */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  // app_metadata carries the tenant claim that every RLS policy reads, so
  // "does this person belong to a school yet" is answerable here without a
  // database round trip.
  let user: { id: string; app_metadata?: Record<string, unknown> } | null = null;

  // Middleware runs in front of EVERY route, so anything that throws here
  // takes the whole site down with MIDDLEWARE_INVOCATION_FAILED -- including
  // /login, leaving no way to recover in the browser. Two things in here can
  // realistically fail, and neither should be fatal:
  //
  //   1. Missing build-time env (see ./lib/supabase/env) -- a deployment
  //      misconfiguration. It must stay loud in the logs, but a 500 on every
  //      route is a worse signal than a login page that cannot sign in.
  //   2. A stale or revoked auth cookie -- an ordinary runtime condition.
  //      Rotating a password or revoking sessions invalidates the refresh
  //      token every existing browser is still holding, and the refresh
  //      attempt can reject at the network layer.
  //
  // Both mean the same thing for routing: treat this request as signed out.
  //
  // ...and so does having no auth cookie at all, without asking anybody.
  try {
    if (!hasAuthCookie(request)) {
      throw new SignedOut();
    }

    const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    // Do not remove: refreshes the auth token and must run before any
    // other Supabase call so the session cookie stays valid.
    const result = await supabase.auth.getUser();
    user = result.data?.user ?? null;
  } catch (error) {
    // A missing cookie is the ordinary case, not a fault, so it is not logged —
    // logging every signed-out request would bury the two failures above in
    // noise, and those are the ones somebody needs to find.
    if (!(error instanceof SignedOut)) {
      console.error("[middleware] auth check failed, treating request as signed out:", error);
    }
    user = null;
  }

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Signed in with no school. Without this the person is bounced around the app
  // seeing empty screens, because RLS correctly refuses every row and nothing
  // says why.
  //
  // The claim is read rather than the database, so this costs nothing — and it
  // is why `platform_start_school` returns `refresh_session_required`: the JWT
  // is minted before the tenant exists, so a caller who does not refresh keeps
  // arriving back here with a school that is already built.
  if (user && !user.app_metadata?.tenant_id) {
    if (pathname !== TENANTLESS_PATH && !isPublicPath(pathname)) {
      return NextResponse.redirect(new URL(TENANTLESS_PATH, request.url));
    }
  } else if (user && pathname === TENANTLESS_PATH) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
