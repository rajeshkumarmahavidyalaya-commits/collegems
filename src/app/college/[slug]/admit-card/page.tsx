import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { loadCollege } from "../college";
import { AdmitCardLookup } from "../lookups";
import { PUBLIC_METADATA, PublicClosed, PublicShell } from "../public-shell";

export const metadata: Metadata = { title: "Admit card", ...PUBLIC_METADATA };

export default async function AdmitCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [college, t] = await Promise.all([loadCollege(slug), getT()]);
  if (!college?.pages.admit_cards) return <PublicClosed college={college} />;
  return (
    <PublicShell college={college} title={t("public.admit.title")} subtitle={t("public.admit.subtitle")}>
      <AdmitCardLookup slug={college.slug} exams={college.admitExams} />
    </PublicShell>
  );
}
