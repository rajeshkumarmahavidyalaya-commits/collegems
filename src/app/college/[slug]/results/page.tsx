import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { loadCollege } from "../college";
import { ResultsLookup } from "../lookups";
import { PUBLIC_METADATA, PublicClosed, PublicShell } from "../public-shell";

export const metadata: Metadata = { title: "Results", ...PUBLIC_METADATA };

export default async function ResultsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [college, t] = await Promise.all([loadCollege(slug), getT()]);
  if (!college?.pages.results) return <PublicClosed college={college} />;
  return (
    <PublicShell college={college} title={t("public.results.title")} subtitle={t("public.results.subtitle")}>
      <ResultsLookup slug={college.slug} />
    </PublicShell>
  );
}
