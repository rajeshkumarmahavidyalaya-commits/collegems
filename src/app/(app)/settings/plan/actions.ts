"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { supabaseUrl } from "@/lib/supabase/env";
import type { ActionResult } from "../../library/actions";

/**
 * Moving a college onto a paid plan.
 *
 * Two steps, and the split is rule 6's: **the app creates an intent; an Edge
 * Function turns it into a link.** The platform's Razorpay key is on that
 * function and nowhere else — not in this file, not in a `NEXT_PUBLIC_*`
 * variable, not in the database.
 *
 *   subscription_start_checkout()      records what the college asked for
 *   platform-subscription-link         asks Razorpay, writes the id back
 *
 * Neither half is gated here. `subscription_start_checkout` is
 * `SECURITY DEFINER` over a table with no write policy and does its own
 * `users.manage` check; the Edge Function reads the row back through the
 * caller's own token, so RLS decides whether it is theirs. Probed live: a
 * teacher calling the first step is refused with *"Your role does not change
 * the college's plan."*
 */

export type CheckoutResult = ActionResult<{ url: string | null; planName: string }>;

export async function startPlanCheckout(planCode: string): Promise<CheckoutResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("subscription_start_checkout", {
    p_plan_code: planCode,
  });

  if (error) {
    // The database's own sentences are written for whoever pressed the button
    // — "Your role does not change the college's plan", "Premium is not set up
    // for online payment on this deployment yet". Paraphrasing them here would
    // be a second copy of a rule that already reads correctly.
    return { ok: false, error: error.message };
  }

  const intent = data as { checkout_id?: string; plan_name?: string } | null;
  if (!intent?.checkout_id) {
    return { ok: false, error: "The checkout could not be started." };
  }

  // The caller's own token goes to the Edge Function, which is what puts RLS
  // between it and the row. `getSession` rather than `getUser` because what is
  // needed is the access token itself; the function verifies it, and Postgres
  // verifies it again through the policy.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return { ok: false, error: "Your session has expired. Sign in again." };
  }

  let url: string | null = null;
  try {
    const response = await fetch(`${supabaseUrl()}/functions/v1/platform-subscription-link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ checkout_id: intent.checkout_id }),
    });

    const answer = (await response.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };

    if (!response.ok) {
      // The intent row survives, carrying its own failure reason where the
      // Edge Function could write one. A college that presses Upgrade twice
      // gets one checkout, not two subscriptions at the provider.
      return { ok: false, error: answer.error ?? "The payment provider could not be reached." };
    }
    url = answer.url ?? null;
  } catch {
    return {
      ok: false,
      error: "The payment provider could not be reached. Nothing has been charged — try again.",
    };
  }

  revalidatePath("/settings/plan");
  return { ok: true, data: { url, planName: intent.plan_name ?? planCode } };
}
