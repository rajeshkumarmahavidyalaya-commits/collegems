import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

const PUBLIC_PATHS = ["/login", "/auth"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  let user: { id: string } | null = null;

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
  try {
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
    console.error("[middleware] auth check failed, treating request as signed out:", error);
    user = null;
  }

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
