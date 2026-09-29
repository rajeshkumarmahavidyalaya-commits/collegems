"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/providers/i18n-provider";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * The letter a job ends in (0300): an admission letter on a student's record,
 * an appointment letter on a member of staff's.
 *
 * Once issued, the button is a link to the letter -- the same numbered
 * document every time, never a second one (the engine refuses two live
 * letters). Before that, one click issues it and opens it with Print and PDF.
 * The write arrives as a bound server action, so this component names nobody
 * and decides nothing about who may (rule 8's split); the page draws it only
 * for `certificates.issue`, and `certificate_issue` is the boundary.
 */
export function LetterButton({
  label,
  existing,
  issue,
}: {
  label: string;
  existing: { id: string; serialNo: string } | null;
  issue: () => Promise<Result<{ id: string; serialNo: string }>>;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();

  if (existing) {
    return (
      <Button asChild variant="outline">
        <Link href={`/certificates/${existing.id}`}>
          <FileText className="size-4" aria-hidden="true" />
          {label} <span className="font-mono text-xs text-muted-foreground">{existing.serialNo}</span>
        </Link>
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await issue();
          if (result.ok) {
            toast.success(t("letters.issued", { label, serial: result.data.serialNo }));
            router.push(`/certificates/${result.data.id}`);
          } else {
            // The engine's refusals are written for a person ("Nothing filled
            // {{class.label}}") and are shown as written.
            toast.error(result.error);
          }
        })
      }
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <FileText className="size-4" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}
