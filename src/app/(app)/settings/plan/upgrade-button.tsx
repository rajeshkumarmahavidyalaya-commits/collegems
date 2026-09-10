"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startPlanCheckout } from "./actions";

/**
 * *Upgrade*, with a confirm step and no pop-up.
 *
 * Two things about the shape:
 *
 * - **The link opens in a new tab rather than replacing the page**, because
 *   the college's own record of what they asked for is on this one. Coming
 *   back from the provider to a screen that has forgotten the request is how
 *   somebody pays twice.
 * - **A pending state that says what is happening.** Creating a subscription
 *   at the provider is a round trip through an Edge Function to Razorpay, so
 *   it is measurably not instant, and a button that merely greys out reads as
 *   broken.
 */
export function UpgradeButton({
  planCode,
  planName,
  purchasable,
}: {
  planCode: string;
  planName: string;
  /** Whether the plan has an id at the payment provider — see migration 0217. */
  purchasable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  // Not disabled-and-silent: an unpurchasable plan is the platform's gap, and
  // `subscription_problems()` says so on /checks in the words a college needs.
  // Drawing nothing here is right, because the alternative is a control that
  // refuses.
  if (!purchasable) return null;

  function go() {
    startTransition(async () => {
      const result = await startPlanCheckout(planCode);
      setConfirming(false);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (result.data.url) {
        window.open(result.data.url, "_blank", "noopener,noreferrer");
        toast.success(`Opened the payment page for ${result.data.planName}.`);
      } else {
        toast.success("The request was recorded. We will be in touch with a payment link.");
      }
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <Button size="sm" variant="outline" className="mt-3" onClick={() => setConfirming(true)}>
        Move to {planName}
      </Button>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={go} disabled={pending}>
        {pending ? (
          <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ExternalLink className="me-2 size-4" aria-hidden="true" />
        )}
        {pending ? "Setting up…" : "Continue to payment"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </Button>
    </div>
  );
}
