import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { loadCollege } from "../college";
import { PublicApplicationForm } from "../forms";
import { PUBLIC_METADATA, PublicClosed, PublicShell } from "../public-shell";

export const metadata: Metadata = { title: "Admission enquiry", ...PUBLIC_METADATA };

export default async function EnquiryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [college, t] = await Promise.all([loadCollege(slug), getT()]);
  if (!college?.pages.enquiry) return <PublicClosed college={college} />;
  return (
    <PublicShell college={college} title={t("public.enquiry.title")} subtitle={t("public.enquiry.subtitle", { college: college.college })}>
      <PublicApplicationForm kind="enquiry" slug={college.slug} college={college.college} classLevels={college.classLevels} />
    </PublicShell>
  );
}
