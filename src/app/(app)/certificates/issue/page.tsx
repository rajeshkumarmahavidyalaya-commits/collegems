import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listTemplates, searchStudents } from "../actions";
import { IssueCertificateForm } from "./issue-form";

export const metadata = { title: "Issue a certificate" };

export default async function IssueCertificatePage() {
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
