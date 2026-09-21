"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CircleAlert, Info, Loader2, Stamp } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  issueCertificate,
  previewCertificate,
  searchStudents,
  type SubjectRow,
  type TemplateRow,
} from "../actions";
import { StudentPicker, type PickedStudent } from "@/components/people/student-picker";
import { useT } from "@/components/providers/i18n-provider";
import {
  KIND_CONSEQUENCE,
  kindLabel,
  missingRequiredFields,
  parseTemplateFields,
  sortProblems,
  type CertificateKind,
  type CertificatePreview,
} from "@/lib/validations/certificates";

// `SubjectRow` comes from the action: id, name, reference, status — the same
// four facts whether the reference is an admission number or an employee code.

export function IssueCertificateForm({
  templates,
  staff,
}: {
  templates: TemplateRow[];
  /**
   * Staff are listed whole and students are not, and the asymmetry is
   * measured rather than assumed: **15 employees against 303 students.** The
   * old screen listed both whole and the student list was
   * `.order("admission_number").limit(20)`, so twenty children could be issued
   * a certificate and 283 were not in the picker at all.
   */
  staff: SubjectRow[];
}) {
  const t = useT();
  const router = useRouter();
  const [subjectId, setSubjectId] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<PickedStudent | null>(null);
  const [templateId, setTemplateId] = useState(
    templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? "",
  );
  const [issuedOn, setIssuedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<CertificatePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [pending, startTransition] = useTransition();

  const template = templates.find((t) => t.id === templateId);
  const fields = useMemo(() => parseTemplateFields(template?.fields), [template?.fields]);
  const consequence = template ? KIND_CONSEQUENCE[template.kind as CertificateKind] : undefined;
  const missing = missingRequiredFields(fields, extra);

  // Which list the picker shows, read off the template rather than chosen.
  const forStaff = template?.subject === "staff";

  // The template's boxes are its own. Switching template keeps nothing, because
  // a "reason for leaving" typed against a transfer certificate is not an
  // answer to a bonafide's "purpose".
  useEffect(() => {
    setExtra({});
  }, [templateId]);

  // Switching between a student template and a staff one clears who was chosen.
  // Keeping a child selected under an experience certificate is not a leak —
  // the engine answers "No such member of staff" — but it is the picker and the
  // template disagreeing, and the person would have to work out why.
  useEffect(() => {
    setSubjectId("");
    setSelectedStudent(null);
  }, [forStaff]);

  useEffect(() => {
    if (!subjectId || !templateId) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setLoadingPreview(true);

    // Settle first. Every keystroke in "reason for leaving" would otherwise be
    // a round trip, and the answer only matters once somebody stops typing.
    const timer = setTimeout(async () => {
      const result = await previewCertificate({ subjectId, templateId, issuedOn, extra });
      if (cancelled) return;
      setLoadingPreview(false);
      if (result.ok) {
        setPreview(result.data);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(result.error);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setLoadingPreview(false);
    };
  }, [subjectId, templateId, issuedOn, extra]);

  function onIssue() {
    startTransition(async () => {
      const result = await issueCertificate({ subjectId, templateId, issuedOn, extra });
      if (result.ok) {
        toast.success(`Certificate ${result.data.serialNo} issued`);
        router.push(`/certificates/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  const problems = preview ? sortProblems(preview.problems) : [];
  const canIssue = Boolean(preview?.can_issue) && missing.length === 0 && !loadingPreview;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
          <CardDescription>
            The school fills itself in. Everything below is what it cannot know.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/*
            One picker, and the **template** decides whose list it shows. The
            person issuing has already said what kind of document this is by
            choosing the wording; asking them a second time which kind of person
            it is for would be a second answer to a question already answered —
            and a way to get the two out of step.
          */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="subject">{forStaff ? "Member of staff" : "Student"}</Label>
            {forStaff ? (
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger id="subject">
                  <SelectValue placeholder="Choose a member of staff" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {s.reference}
                      {s.status !== "active" ? ` · ${s.status}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <StudentPicker
                id="subject"
                search={searchStudents}
                selected={selectedStudent}
                onSelect={(row) => {
                  setSelectedStudent(row);
                  setSubjectId(row.id);
                }}
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template">Certificate</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="template">
                <SelectValue placeholder="Choose a certificate" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name} · {kindLabel(template.kind, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issued-on">Date of issue</Label>
            <Input
              id="issued-on"
              type="date"
              value={issuedOn}
              onChange={(e) => setIssuedOn(e.target.value)}
            />
          </div>

          {fields.map((field) => (
            <div key={field.name} className="flex flex-col gap-1.5">
              <Label htmlFor={`extra-${field.name}`}>
                {field.label}
                {field.required && (
                  <span className="ms-1 text-destructive" aria-hidden="true">
                    *
                  </span>
                )}
              </Label>
              <Input
                id={`extra-${field.name}`}
                value={extra[field.name] ?? ""}
                placeholder={field.placeholder}
                aria-required={field.required}
                onChange={(e) =>
                  setExtra((prev) => ({ ...prev, [field.name]: e.target.value }))
                }
              />
            </div>
          ))}

          {consequence && (
            <Alert>
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>This changes a record</AlertTitle>
              <AlertDescription>{consequence}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>
                Exactly what will be printed, except the number — that is allocated when it is
                issued.
              </CardDescription>
            </div>
            {preview && (
              <Badge variant={preview.can_issue ? "success" : "warning"}>
                {preview.can_issue ? "Ready" : "Not ready"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!subjectId ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Choose a student to see the certificate.
            </p>
          ) : loadingPreview && !preview ? (
            <div className="flex flex-col gap-2" aria-hidden="true">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-9/12" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : previewError ? (
            <Alert variant="destructive">
              <CircleAlert className="size-4" aria-hidden="true" />
              <AlertTitle>The preview could not be built</AlertTitle>
              <AlertDescription>{previewError}</AlertDescription>
            </Alert>
          ) : preview ? (
            <>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-4 font-sans text-sm leading-relaxed">
                {preview.body}
              </pre>

              {/* The server's sentences, in the order somebody acts on them.
                  `aria-live` because they change as the form is filled in. */}
              <div className="flex flex-col gap-2" aria-live="polite">
                {problems.map((problem, i) => (
                  <div
                    key={`${problem.severity}-${i}`}
                    className="flex items-start gap-2 rounded-md border p-3 text-sm"
                  >
                    {problem.severity === "error" ? (
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                    ) : problem.severity === "warning" ? (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    ) : (
                      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span>
                      <span className="sr-only">
                        {problem.severity === "error"
                          ? "Blocking: "
                          : problem.severity === "warning"
                            ? "Warning: "
                            : "Note: "}
                      </span>
                      {problem.message}
                    </span>
                  </div>
                ))}
              </div>

              <Button onClick={onIssue} disabled={!canIssue || pending} className="self-start">
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Stamp className="size-4" aria-hidden="true" />
                )}
                Issue and number it
              </Button>
              {!canIssue && !loadingPreview && (
                <p className="text-xs text-muted-foreground">
                  Everything marked as blocking above has to be settled first.
                </p>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
