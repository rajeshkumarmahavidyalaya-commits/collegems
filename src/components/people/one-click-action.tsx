"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Result = { ok: true; data: { message: string } } | { ok: false; error: string };

/**
 * One button, one bound server action, one sentence back. The action carries
 * the authority (rule 8's split); this only presses it and shows what it said,
 * success and refusal alike, then refreshes so the step reads as done.
 */
export function OneClickAction({ label, run }: { label: string; run: () => Promise<Result> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await run();
          if (result.ok) {
            toast.success(result.data.message);
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Send className="size-4" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}
