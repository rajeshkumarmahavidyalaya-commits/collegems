import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Briefcase, CalendarDays, ClipboardList, FileText, IdCard, MessageSquare } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages/en";
import type { PublicPage } from "@/lib/validations/public-pages";
import { loadCollege } from "./college";
import { PUBLIC_METADATA, PublicClosed, PublicShell } from "./public-shell";

export const metadata: Metadata = { title: "Online services", ...PUBLIC_METADATA };

const LINKS: { page: PublicPage; path: (slug: string) => string; key: string; icon: typeof FileText }[] = [
  { page: "apply", path: (s) => `/apply/${s}`, key: "public.link.apply", icon: FileText },
  { page: "enquiry", path: (s) => `/college/${s}/enquiry`, key: "public.link.enquiry", icon: MessageSquare },
  { page: "exam_timetable", path: (s) => `/college/${s}/exams`, key: "public.link.exams", icon: CalendarDays },
  { page: "admit_cards", path: (s) => `/college/${s}/admit-card`, key: "public.link.admitCard", icon: IdCard },
  { page: "results", path: (s) => `/college/${s}/results`, key: "public.link.results", icon: ClipboardList },
  { page: "certificate_check", path: (s) => `/college/${s}/verify`, key: "public.link.verify", icon: BadgeCheck },
  { page: "staff_application", path: (s) => `/college/${s}/jobs`, key: "public.link.jobs", icon: Briefcase },
];

/** What a college has opened to the public, and nothing it has not. */
export default async function CollegePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [college, t] = await Promise.all([loadCollege(slug), getT()]);
  if (!college) return <PublicClosed college={null} />;

  const open = LINKS.filter((l) => college.pages[l.page]);
  return (
    <PublicShell
      college={college}
      back={false}
      title={college.college}
      subtitle={t("public.subtitle", { session: college.session ?? "" })}
    >
      {college.note ? (
        // The college's own words, rendered as text, never as markup.
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm whitespace-pre-line text-foreground">
          {college.note}
        </p>
      ) : null}
      <h2 className="text-lg font-semibold text-foreground">{t("public.heading")}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {open.map(({ page, path, key, icon: Icon }) => (
          <li key={page}>
            <Link
              href={path(college.slug)}
              className="flex h-full items-start gap-3 rounded-lg border border-border bg-card px-4 py-4 transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="flex flex-col gap-1">
                <span className="font-medium text-foreground">{t(key as MessageKey)}</span>
                <span className="text-sm text-muted-foreground">{t(`${key}.body` as MessageKey)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PublicShell>
  );
}
