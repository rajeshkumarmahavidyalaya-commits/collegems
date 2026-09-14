"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Upload, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BUCKET_LIMITS } from "@/lib/storage/constants";
import type { ActionResult } from "@/app/(app)/library/actions";

/**
 * The upload control `people.photo_path` never had — for anybody who is a person.
 *
 * It lived under `students/[id]/` first and moved here when staff needed the
 * same control. The **actions are props**, not imports: a server action is a
 * serialisable reference, so a Server Component can hand this one the pair that
 * belongs to its own module. That is what keeps the shared half genuinely
 * shared — the choreography and the interface are one implementation, while
 * *"may this caller change this person's photograph"* stays two different
 * selects against two different policies.
 *
 * The limits are stated **before** a file is chosen, which is the whole reason
 * `storage/constants.ts` exists separately from `files.ts`: that module imports
 * the server client and cannot be bundled here, but a person about to pick a
 * 40 MB photograph deserves to know the ceiling first rather than after the
 * upload fails.
 *
 * ## Its labels are props, and that was measured rather than assumed
 *
 * The first version called `useI18n()`, which is the ordinary shape for a
 * client component and was **the wrong one here**. Built both ways:
 * `/students/[id]` went **165 kB → 187 kB**, +22 kB — and `sonner` was already
 * on the route through `ExitControl`, so every byte of that was the message
 * catalogue arriving for the *first* time on a route that had never had a
 * client-side i18n consumer.
 *
 * `docs/ui-review.md` already named the threshold: *"translating one badge is
 * nearly free on a route that already speaks, and costs the whole catalogue on
 * a route that does not — the day to split the catalogue is when a light route
 * pays 16 kB for one word."* This was past it.
 *
 * So the parent is a Server Component that already holds `t` from `getT()`, and
 * it passes seven resolved strings down. Rule 15's fourth shape, applied for a
 * weight reason rather than a correctness one: **a component that needs a
 * handful of words does not need the dictionary.**
 */

export type PhotoLabels = {
  heading: string;
  choose: string;
  replace: string;
  remove: string;
  none: string;
  limit: string;
  uploaded: string;
  removed: string;
};
export function PhotoControl({
  ownerId,
  photoUrl,
  canManage,
  labels,
  onUpload,
  onRemove,
}: {
  /** The student or staff id the actions below take. */
  ownerId: string;
  photoUrl: string | null;
  canManage: boolean;
  labels: PhotoLabels;
  onUpload: (id: string, form: FormData) => Promise<ActionResult<{ path: string }>>;
  onRemove: (id: string) => Promise<ActionResult<void>>;
}) {
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<string | null>(photoUrl);
  const input = useRef<HTMLInputElement>(null);
  const limits = BUCKET_LIMITS["avatars"];

  function upload(file: File) {
    const form = new FormData();
    form.set("photo", file);
    start(async () => {
      const result = await onUpload(ownerId, form);
      if (result.ok) {
        // Show the local file immediately rather than waiting for a new signed
        // URL: the object is already uploaded, and a photograph that appears a
        // second after the toast reads as a failure that then worked.
        setPreview(URL.createObjectURL(file));
        toast.success(labels.uploaded);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <User className="size-6 text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          {preview ? labels.heading : labels.none}
        </p>

        {canManage && (
          <>
            <input
              ref={input}
              type="file"
              accept={limits.accept.join(",")}
              className="sr-only"
              aria-label={labels.choose}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(file);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => input.current?.click()}
                className="cursor-pointer"
              >
                <Upload className="size-4" aria-hidden="true" />
                {preview ? labels.replace : labels.choose}
              </Button>
              {preview && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  className="cursor-pointer text-destructive"
                  onClick={() =>
                    start(async () => {
                      const result = await onRemove(ownerId);
                      if (result.ok) {
                        setPreview(null);
                        toast.success(labels.removed);
                      } else {
                        toast.error(result.error);
                      }
                    })
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  {labels.remove}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {labels.limit}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
