"use client";

/**
 * The last boundary: an error thrown by the **root layout itself**.
 *
 * Everything else is caught by `(app)/error.tsx`. This one is different in a way
 * that decides how it is written: it *replaces* the root layout, so it must
 * render its own `<html>` and `<body>`, and — the part that matters — **none of
 * the providers are mounted.** No `I18nProvider`, so no `useI18n`; no
 * `ThemeProvider`, so no theme class.
 *
 * So this is the one screen in the product that is deliberately **not
 * translated**, and it says so here rather than looking like an oversight for
 * somebody to "fix" by importing a hook that would throw. Rule 15 is about
 * strings a reader will meet; this is a string that only appears when the thing
 * that renders strings is broken.
 *
 * It also carries its own colours inline rather than through the Tailwind
 * tokens, for the same reason: `globals.css` is imported by the root layout that
 * just failed. Hardcoded hex is forbidden in components and this is not one — it
 * is the page that exists for when components do not work. Both values are
 * checked at 4.5:1 on white.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#ffffff",
          color: "#1f2933",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }} role="alert">
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            SchoolOS could not start
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#52606d", margin: "0 0 1rem" }}>
            Nothing has been lost. This is a problem loading the application itself — your
            school&rsquo;s records are not affected.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.75rem",
                color: "#52606d",
                margin: "0 0 1rem",
              }}
            >
              Reference {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              border: "1px solid #cbd2d9",
              borderRadius: "0.375rem",
              background: "#ffffff",
              color: "#1f2933",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
