"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateSeatPlan } from "../../seating-actions";

/**
 * The one control on this page that needs state.
 *
 * It is its own file so the sittings list stays a Server Component. Rule 15's
 * measurement: a route that has no client code pays nothing, and a route that
 * gains its first `useI18n()` pays the whole 57 kB catalogue — so this island
 * deliberately does not reach for one. The two words it renders are in English
 * beside a page of English, which is the honest state of this module's copy
 * rather than a saving.
 */
export function GenerateSitting({
  examId,
  sitsOn,
  candidates,
}: {
  examId: string;
  sitsOn: string;
  candidates: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await generateSeatPlan(examId, sitsOn);
      if (!result.ok) {
        // The sentence comes from the function that refused. It names the
        // numbers — how many candidates, how many seats, which setting to
        // change — and replacing it here with "Could not generate" would throw
        // away the only part that tells somebody what to do next.
        toast.error(result.error);
        return;
      }
      toast.success(
        `Seated ${result.data.seated} candidate${result.data.seated === 1 ? "" : "s"} across ` +
          `${result.data.rooms} room${result.data.rooms === 1 ? "" : "s"}. Nobody has been told yet.`,
      );
      router.push(`/exams/${examId}/seating/${result.data.planId}`);
    });
  }

  return (
    <Button onClick={run} disabled={pending || candidates === 0}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Wand2 className="size-4" aria-hidden="true" />
      )}
      Make a plan
    </Button>
  );
}
