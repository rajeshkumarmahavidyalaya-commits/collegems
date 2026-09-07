"use client";

import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/storage/constants";
import { attachmentUrl } from "../actions";

/**
 * A button, not a link.
 *
 * Rule 8: a signed URL *is* the authorization, so rendering one into the page
 * signs it before anybody asked — which is the same as publishing the file, to
 * anyone who views source or shares the page. The URL is fetched on the click,
 * used, and never stored.
 */
export function AttachmentLink({
  fileId,
  fileName,
  sizeBytes,
}: {
  fileId: string;
  fileName: string;
  sizeBytes: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function open() {
    startTransition(async () => {
      const result = await attachmentUrl(fileId);
      if (result.ok) {
        setFailed(false);
        window.open(result.data.url, "_blank", "noopener,noreferrer");
      } else {
        setFailed(true);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{fileName}</p>
        {sizeBytes !== null && (
          <p className="text-xs text-muted-foreground">{formatBytes(sizeBytes)}</p>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={open} disabled={pending}>
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="size-3.5" aria-hidden="true" />
        )}
        {failed ? "Try again" : "Open"}
      </Button>
    </div>
  );
}
