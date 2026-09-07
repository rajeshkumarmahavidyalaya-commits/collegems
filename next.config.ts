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
   * `X-Powered-By: Next.js` on every response tells an attacker what to try
   * and tells a user nothing.
   */
  poweredByHeader: false,
};

export default nextConfig;
