import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { listTemplates, searchStudents } from "../actions";
import { IssueCertificateForm } from "./issue-form";

export const metadata = { title: "Issue a certificate" };

/**
 * Hiding the button on the register is not a gate — the URL is still typeable,
 * and rule 4's sentence cuts both ways: the UI layer never protects data, so it
 * has to be honest about what it is doing instead. Somebody who arrives here
 * without `certificates.issue` gets a sentence rather than a form that ends in
 * a Postgres error about `document_sequences`.
 */
export default async function IssueCertificatePage() {
  const canIssue = await hasPermission("certificates.issue");

  if (!canIssue) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          href="/certificates"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          Certificates
        </Link>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <ShieldAlert className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium">Your role does not issue certificates</p>
            <p className="max-w-md text-sm text-muted-foreground">
              A certificate carries a number from a gapless series and cannot be edited once it is
              issued, so the college decides who may create one. You can still read the register.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [templates, students] = await Promise.all([listTemplates(), searchStudents("")]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/certificates"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          Certificates
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Issue a certificate</h1>
        <p className="text-sm text-muted-foreground">
          Choose the student and the wording, fill in whatever the school cannot know, and read the
          certificate before it is numbered.
        </p>
      </div>

      <IssueCertificateForm templates={templates} initialStudents={students} />
    </div>
  );
}
