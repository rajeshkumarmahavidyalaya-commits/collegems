import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Turns a subscription checkout into a Razorpay subscription and its short URL.
 *
 * This is `razorpay-create-link` one level up, and the level matters more than
 * the code does:
 *
 *   razorpay-create-link       a COLLEGE charges a FAMILY  -> RAZORPAY_*
 *   platform-subscription-link the PLATFORM charges a COLLEGE -> PLATFORM_RAZORPAY_*
 *
 * **Two flows of money in opposite directions, two merchant accounts, two
 * secrets.** Sharing them would make a signature bug in the fee webhook also a
 * signature bug in the thing that decides whether a school keeps its
 * subscription — and would let a college's own gateway credentials collect the
 * platform's revenue.
 *
 * Deployed WITH JWT verification, and that is not enough on its own: a valid
 * token only proves somebody is signed in. So the checkout row is read back
 * through a client carrying the CALLER'S token, which puts RLS in the way — the
 * row is visible only to members of the college it belongs to, and
 * `subscription_start_checkout` already refused anybody without `users.manage`
 * before the row existed at all. The service role is used for exactly one
 * thing afterwards: writing the provider's ids back onto a table that has no
 * write policy.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const keyId = Deno.env.get("PLATFORM_RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("PLATFORM_RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) {
    // Fail closed and say which half is missing in the log, never in the
    // response — "which secret is unset" is a fact about the deployment.
    console.error("PLATFORM_RAZORPAY_KEY_ID / _SECRET not set; cannot create a subscription");
    return json({ error: "Subscription billing is not configured on this deployment" }, 503);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Sign in first" }, 401);

  let body: { checkout_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body is not JSON" }, 400);
  }
  if (!body.checkout_id) return json({ error: "checkout_id is required" }, 400);

  // The caller's own token, so RLS decides whether this checkout is theirs.
  const asCaller = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  );

  const { data: checkout, error: readError } = await asCaller
    .from("subscription_checkouts")
    .select("id, tenant_id, plan_code, status, expires_at, provider_subscription_id, checkout_url")
    .eq("id", body.checkout_id)
    .maybeSingle();

  if (readError || !checkout) return json({ error: "No such checkout" }, 404);

  // Already linked: hand back the same URL rather than creating a second
  // subscription at the provider. Two live subscriptions for one college is
  // two monthly charges, and the college would be right to be angry about it.
  if (checkout.provider_subscription_id && checkout.checkout_url) {
    return json({ url: checkout.checkout_url, subscription_id: checkout.provider_subscription_id });
  }

  if (checkout.status !== "pending") return json({ error: "That checkout is no longer open" }, 409);
  if (new Date(checkout.expires_at).getTime() < Date.now()) {
    return json({ error: "That checkout has expired — start again" }, 409);
  }

  // The plan's id at the provider lives in `reference.plans`, which is not
  // exposed to PostgREST, so it is read with the service role. It is
  // deployment configuration rather than tenant data, and the college has
  // already been told the plan is purchasable by the function that made this
  // row — a null here at this point is a race, not a normal state.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: plan, error: planError } = await admin
    .schema("reference")
    .from("plans")
    .select("code, name, provider_plan_id, price_minor, currency")
    .eq("code", checkout.plan_code)
    .maybeSingle();

  if (planError || !plan?.provider_plan_id) {
    return json({ error: "That plan is not set up for online payment yet" }, 409);
  }

  const form = new URLSearchParams({
    plan_id: plan.provider_plan_id,
    // Razorpay requires a count; twelve months is a year of billing, after
    // which the college renews deliberately rather than being charged for ever
    // by a link somebody clicked once.
    total_count: "12",
    customer_notify: "1",
    // Carried back on every webhook, so the callback can find this row without
    // trusting anything else in the body.
    "notes[checkout_id]": checkout.id,
    "notes[tenant_id]": checkout.tenant_id,
  });

  const response = await fetch("https://api.razorpay.com/v1/subscriptions", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });

  const created = await response.json().catch(() => ({}));

  if (!response.ok || !created?.id) {
    const reason = created?.error?.description ?? `Provider answered ${response.status}`;
    console.error("Razorpay refused to create a subscription", reason);
    // Written down rather than only logged: a college pressing Upgrade and
    // seeing nothing happen has no way to find out why, and the row is where
    // somebody looks.
    await admin
      .from("subscription_checkouts")
      .update({ status: "failed", failure_reason: String(reason).slice(0, 300) })
      .eq("id", checkout.id);
    return json({ error: "Could not start the subscription with the payment provider" }, 502);
  }

  const url: string | undefined = created.short_url;

  const { error: writeError } = await admin
    .from("subscription_checkouts")
    .update({
      provider: "razorpay",
      provider_subscription_id: created.id,
      checkout_url: url ?? null,
      status: "linked",
    })
    .eq("id", checkout.id);

  if (writeError) {
    // The subscription exists at the provider and this system has lost its id,
    // which is the one failure here that costs money. Loud, with the id in the
    // log so it can be reconciled by hand.
    console.error("Created Razorpay subscription but could not record it", created.id, writeError);
    return json({ error: "Started, but could not be recorded — contact support" }, 500);
  }

  return json({ url, subscription_id: created.id });
});
