"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/i18n-provider";
import { chooseYear } from "@/app/(app)/year-actions";

/**
 * Above every page while a year other than the working one is open (0355).
 * Postgres keeps that year read-only whatever is pressed; this says so before
 * anybody tries, and is one click from the working year.
 */
export function YearBanner({ viewing, working, workingId }: { viewing: string; working: string; workingId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="status" data-print="hide" className="mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-warning bg-warning/15 px-4 py-3 text-sm">
      <History className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t("year.viewing.title", { name: viewing })}</p>
        <p className="text-muted-foreground">{t("year.viewing.body", { working })}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await chooseYear(workingId);
            if (!r.ok) return void toast.error(r.error);
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Undo2 className="size-4" aria-hidden="true" />}
        {t("year.viewing.back", { name: working })}
      </Button>
    </div>
  );
}
