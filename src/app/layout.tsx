import type { Metadata } from "next";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { I18nProvider } from "@/components/providers/i18n-provider";
import { getLocale } from "@/lib/i18n/server";
import { clientMessagesFor } from "@/lib/i18n/translate";
import { directionOf } from "@/lib/i18n/config";
import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// The reference uses the system font stack (globals.css --font-sans), so no
// web font is downloaded or preloaded on any page.

export const metadata: Metadata = {
  title: {
    default: "SchoolOS",
    template: "%s · SchoolOS",
  },
  description: "Multi-tenant school management, built for the people who run the school.",
};

/**
 * `lang` and `dir` are decided here, once, from the locale resolved
 * server-side — never from the browser. Getting `dir` onto `<html>` rather
 * than onto a wrapper matters: scrollbar placement, the direction a
 * `<select>` drops in, and every logical Tailwind utility below all read it
 * from the document element.
 *
 * This makes the root layout dynamic, which it already was, at the cost of one
 * `auth.getUser()` per request on top of the one the app layout makes. Worth
 * it: the alternative is rendering the whole page in English and turning it
 * around after hydration, which is a visible flip on every load.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <QueryProvider>
            <I18nProvider locale={locale} messages={clientMessagesFor(locale)}>
              {children}
              {/* The toast rail follows the reading direction: a message that
                  appears in the corner your eye does not start from is a
                  message you find after it has gone. */}
              <Toaster
                position={directionOf(locale) === "rtl" ? "top-left" : "top-right"}
                richColors
                closeButton
              />
            </I18nProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
