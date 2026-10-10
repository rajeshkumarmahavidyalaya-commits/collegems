import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { COLLEGE } from "@/lib/site/content";

// The public website: the pages a family reads before they have a login. Kept
// out of the signed-in shell on purpose, and in its own route group so the ERP
// layout (sidebar, session, permissions) never wraps it.
export const metadata: Metadata = {
  title: {
    default: `${COLLEGE.name}, ${COLLEGE.city}`,
    template: `%s · ${COLLEGE.name}`,
  },
  description: COLLEGE.intro,
  robots: { index: true, follow: true },
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
