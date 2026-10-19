import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { loadCollege } from "../college";
import { PublicApplicationForm } from "../forms";
import { PUBLIC_METADATA, PublicClosed, PublicShell } from "../public-shell";

export const metadata: Metadata = { title: "Apply for a job", ...PUBLIC_METADATA };

export default async function JobsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [college, t] = await Promise.all([loadCollege(slug), getT()]);
  if (!college?.pages.staff_application) return <PublicClosed college={college} />;
  return (
    <PublicShell college={college} title={t("public.jobs.title")} subtitle={t("public.jobs.subtitle", { college: college.college })}>
      <PublicApplicationForm kind="jobs" slug={college.slug} college={college.college} classLevels={college.classLevels} />
    </PublicShell>
  );
}
