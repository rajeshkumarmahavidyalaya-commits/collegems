import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Rewrites `import { X } from "pkg"` into a deep import of just `X`, so a
     * barrel file does not drag its whole package into the chunk. Next applies
     * this to a default list that already covers `lucide-react` and the Radix
     * packages; these are the ones this app uses that are not on it.
     *
     * `recharts` is here as a belt-and-braces measure — the dashboard now loads
     * it through `next/dynamic` (see `src/components/dashboard/charts.tsx`),
     * which is what actually keeps its 404 kB off the first load.
     */
    optimizePackageImports: ["recharts", "@tanstack/react-table", "@tanstack/react-query"],
  },

  /**
   * The PDF renderer reads its font from disk at runtime
   * (`src/lib/pdf/fonts/WorkSans-Regular.ttf`), which Next's file tracer has to
   * find for the font to reach the serverless bundle at all — and the failure
   * mode if it does not is the worst shape a deployment bug has: **every PDF
   * request 500s in production while every test passes locally.**
   *
   * **Measured, and the first version of this comment was wrong.** Built with
   * these three lines deleted: the tracer finds the `.ttf` on its own, for both
   * routes. So this is not what makes it work today, and saying it was would
   * have been a comment answering the question somebody was about to ask with
   * the wrong answer.
   *
   * It stays because *why* the tracer succeeds is narrow: it can follow a
   * `readFile(join(process.cwd(), "<string literal>"))` and cannot follow a
   * path that is computed. A refactor that builds the filename — a second
   * script, a weight, a locale — drops the font silently and only production
   * finds out. `tests/pdf/document.test.ts` guards the literal directly, which
   * is the executable half; this is the declaration of intent beside it.
   *
   * Scoped to the two routes that render a PDF rather than applied globally: a
   * blanket include puts 189 kB into every function in the app.
   */
  outputFileTracingIncludes: {
    "/(app)/certificates/[id]/pdf": ["./src/lib/pdf/fonts/**"],
    "/(app)/fees/invoices/[invoiceId]/pdf": ["./src/lib/pdf/fonts/**"],
  },

  /**
   * `X-Powered-By: Next.js` on every response tells an attacker what to try
   * and tells a user nothing.
   */
  poweredByHeader: false,
};

export default nextConfig;
