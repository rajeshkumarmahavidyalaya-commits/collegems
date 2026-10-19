import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { loadCollege } from "../college";
import { CertificateLookup } from "../lookups";
import { PUBLIC_METADATA, PublicClosed, PublicShell } from "../public-shell";

export const metadata: Metadata = { title: "Verify a certificate", ...PUBLIC_METADATA };

export default async function VerifyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [college, t] = await Promise.all([loadCollege(slug), getT()]);
  if (!college?.pages.certificate_check) return <PublicClosed college={college} />;
  return (
    <PublicShell college={college} title={t("public.verify.title")} subtitle={t("public.verify.subtitle")}>
      <CertificateLookup slug={college.slug} />
    </PublicShell>
  );
}
