import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getCertificate } from "../actions";
import { kindLabel } from "@/lib/validations/certificates";
import { hasPermission } from "@/lib/auth/permissions";
import { CancelCertificate } from "./cancel-certificate";
import { PrintButton } from "./print-button";
import { AuditTrail } from "@/components/audit/audit-trail";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Certificate" };

/**
 * One certificate, as it was issued.
 *
 * The page renders `certificates.body` — the text frozen at issue — and nothing
 * else. It does not look the student up, does not recompute the attendance
 * line, and does not consult the template. A duplicate printed in ten years is
 * the same document as the original, and that is only true because this page
 * refuses to be clever.
 */
export default async function CertificatePage({ params }: PageProps<"/certificates/[id]">) {
  const t = await getT();
  const { id } = await params;
  const certificate = await getCertificate(id);
  if (!certificate) notFound();

  const snapshot = (certificate.snapshot ?? {}) as Record<string, string | null>;
  const cancelled = certificate.status === "cancelled";
  // `certificates.issue`, because the catalogue row says so in as many words:
  // *"Issue and cancel certificates"*. The first draft of this gated cancelling
  // on `certificates.manage` — which reads plausibly and is wrong, because that
  // row means *"Write and retire certificate templates"*. The catalogue was the
  // older decision and a coherent one: whoever raises a document voids it, and
  // voiding is not a template edit.
  //
  // The column grant behind this (migration 0135) already says nobody, an
  // administrator included, may rewrite what a certificate *says*. This decides
  // only who may strike it through.
  const canCancel = await hasPermission("certificates.issue");

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide" className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/certificates"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            Certificates
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold">
            <span className="font-mono text-xl">{certificate.serial_no}</span>
            <Badge variant={cancelled ? "destructive" : "success"}>
              {cancelled ? "Cancelled" : "Issued"}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {kindLabel(certificate.kind, t)} · {certificate.template_name} · issued{" "}
            {certificate.issued_on}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintButton />
          {!cancelled && canCancel && (
            <CancelCertificate certificateId={certificate.id} serialNo={certificate.serial_no} />
          )}
        </div>
      </div>

      {cancelled && (
        <Alert variant="destructive" data-print="keep">
          <Ban className="size-4" aria-hidden="true" />
          <AlertTitle>This certificate has been cancelled</AlertTitle>
          <AlertDescription>
            {certificate.cancel_reason}
            {certificate.cancelled_at ? ` — ${certificate.cancelled_at.slice(0, 10)}` : ""}. It
            keeps its number: a gapless register with a hole in it is a register nobody can audit.
          </AlertDescription>
        </Alert>
      )}

      {/* The document. `data-print="sheet"` drops the card chrome and forces
          white, so a school's dark mode does not put a black rectangle through
          their toner. */}
      <article
        data-print="sheet"
        className="mx-auto w-full max-w-3xl rounded-lg border bg-card p-8 shadow-sm sm:p-12"
      >
        <header className="mb-8 border-b pb-6 text-center">
          <h2 className="text-xl font-semibold tracking-tight">
            {snapshot["school.name"] ?? ""}
          </h2>
          {snapshot["school.address"] && (
            <p className="mt-1 text-sm text-muted-foreground">{snapshot["school.address"]}</p>
          )}
          <p className="mt-4 text-sm font-semibold uppercase tracking-[0.2em]">
            {kindLabel(certificate.kind, t)}
          </p>
        </header>

        <div className="whitespace-pre-wrap text-[15px] leading-8">{certificate.body}</div>

        <footer className="mt-16 flex items-end justify-between gap-8 text-sm">
          <div className="text-muted-foreground">
            <p className="font-mono text-xs">{certificate.serial_no}</p>
          </div>
          <div className="text-center">
            <div className="mb-1 w-48 border-t border-foreground/40" />
            <p>Principal</p>
          </div>
        </footer>
      </article>

      {/* A certificate is a legal record that can be cancelled, so "who
          cancelled this, and when" is the question the audit log exists to
          answer. `data-print="hide"` keeps it off the printed sheet -- it is
          the school's record of the document, not part of the document. */}
      <div data-print="hide" className="mx-auto w-full max-w-3xl">
        <AuditTrail table="certificates" rowId={certificate.id} title="Record history" />
      </div>
    </div>
  );
}
