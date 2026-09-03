"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { BUCKET_LIMITS, BUCKETS } from "@/lib/storage/constants";
import { attachFile, detachFile, downloadUrlFor, type FileRow } from "./actions";

type Owner = { homeworkId: string } | { submissionId: string };

type Props = {
  owner: Owner;
  files: FileRow[];
  title: string;
  canUpload: boolean;
  emptyHint?: string;
};

/**
 * The one file-list-and-upload control the module uses, for the question sheet
 * and for a student's answer alike.
 *
 * A download is never a plain `href`. The button asks the server for a signed
 * URL, and the server issues one only after reading the row back through RLS —
 * so the click is the permission check. A link rendered into the page would
 * have had to be signed before anyone asked for it.
 */
export function AttachmentPanel({ owner, files, title, canUpload, emptyHint }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const bucket = "homeworkId" in owner ? BUCKETS.studyMaterial : BUCKETS.homeworkSubmissions;
  const limits = BUCKET_LIMITS[bucket];
  const inputId = `attach-${"homeworkId" in owner ? owner.homeworkId : owner.submissionId}`;

  function upload(file: File) {
    const data = new FormData();
    data.set("file", file);
    startTransition(async () => {
      const result = await attachFile(owner, data);
      if (inputRef.current) inputRef.current.value = "";
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${file.name} attached.`);
      router.refresh();
    });
  }

  function open(file: FileRow) {
    setBusyId(file.id);
    startTransition(async () => {
      const result = await downloadUrlFor(file.id);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    });
  }

  function remove(file: FileRow) {
    if (!window.confirm(`Remove "${file.fileName}"? This deletes the file and cannot be undone.`)) {
      return;
    }
    setBusyId(file.id);
    startTransition(async () => {
      const result = await detachFile(file.id);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("File removed.");
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-border p-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Paperclip className="size-4 text-muted-foreground" aria-hidden="true" />
        {title}
      </h3>

      {files.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {emptyHint ?? "Nothing attached."}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate text-sm">{file.fileName}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {file.sizeLabel}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending && busyId === file.id}
                  onClick={() => open(file)}
                  aria-label={`Download ${file.fileName}`}
                >
                  <Download className="size-4" aria-hidden="true" />
                </Button>
                {canUpload && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending && busyId === file.id}
                    onClick={() => remove(file)}
                    aria-label={`Remove ${file.fileName}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Label htmlFor={inputId} className="sr-only">
            Attach a file
          </Label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={limits.accept.join(",")}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4" aria-hidden="true" />
            {pending ? "Uploading…" : "Attach a file"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Up to {Math.round(limits.maxBytes / (1024 * 1024))} MB
          </span>
        </div>
      )}
    </section>
  );
}
