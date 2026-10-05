"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { BUCKET_LIMITS, formatBytes } from "@/lib/storage/constants";
import { attachFile, removeAttachment } from "../actions";

/**
 * Adding and removing a notice's files. `attachFile` and `removeAttachment`
 * existed with no caller (the 0333 sweep), so the board could show
 * attachments and nobody could add one: a circular went out without the
 * timetable it referred to. Drawn for notices.manage; the "admins manage
 * notice files" policy and the storage tenant check are the gate (rule 8).
 */
export function AttachmentsEditor({
  noticeId,
  files,
}: {
  noticeId: string;
  files: { id: string; file_name: string }[];
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, start] = useTransition();
  const limit = BUCKET_LIMITS.documents;

  function upload() {
    if (!file) return void toast.error("Choose a file first.");
    const data = new FormData();
    data.set("noticeId", noticeId);
    data.set("file", file);
    start(async () => {
      const r = await attachFile(data);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${file.name} attached.`);
      setFile(null);
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{f.file_name}</span>
              <ConfirmDeleteButton
                iconOnly
                label={`Remove ${f.file_name}`}
                title={`Remove ${f.file_name}?`}
                description="The file is deleted from the notice. Anybody who already downloaded it keeps their copy."
                action={removeAttachment.bind(null, f.id)}
                success={`${f.file_name} removed.`}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="notice-file">Attach a file</Label>
          <Input
            id="notice-file"
            ref={input}
            type="file"
            accept={limit.accept.join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">Up to {formatBytes(limit.maxBytes)}.</p>
        </div>
        <Button type="button" variant="outline" disabled={pending || !file} onClick={upload}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
          Attach
        </Button>
      </div>
    </div>
  );
}
