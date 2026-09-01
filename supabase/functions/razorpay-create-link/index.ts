import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Turns a payment intent into a Razorpay payment link.
 *
 * This function holds the Razorpay secret, which is why it exists at all: the
 * Next.js app never sees it, so it cannot leak into a bundle or a log there.
 *
 * Deployed WITH JWT verification, and that is not enough on its own -- a valid
 * JWT only proves someone is signed in, not that this intent is theirs. So the
 * intent is read back through a client carrying the CALLER'S token, which puts
 * the existing RLS policies in the way: a student cannot fetch another
 * family's intent, and only admins and accountants can fetch one at all. The
 * service role is used for exactly one thing afterwards -- writing the order
 * id back.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) {
    return json(
      { error: "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." },
      503,
    );
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Not signed in" }, 401);

  let body: { intentId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body is not JSON" }, 400);
  }
  if (!body.intentId) return json({ error: "intentId is required" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;

  // The caller's own token, so RLS decides what they may see.
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: intent, error: readError } = await asCaller
    .from("payment_intents")
    .select("id, tenant_id, amount, status, provider_order_id, payment_url, student_id")
    .eq("id", body.intentId)
    .maybeSingle();

  if (readError) return json({ error: readError.message }, 500);
  if (!intent) return json({ error: "Payment intent not found" }, 404);

  // Already has a link: hand back the same one rather than creating a second
  // order for the same money.
  if (intent.provider_order_id && intent.payment_url) {
    return json({ paymentUrl: intent.payment_url, orderId: intent.provider_order_id, reused: true });
  }
  if (intent.status !== "created") {
    return json({ error: `This intent is ${intent.status}` }, 409);
  }

  const { data: student } = await asCaller
    .from("students")
    .select("admission_number, people:person_id ( first_name, last_name, phone, email )")
    .eq("id", intent.student_id)
    .maybeSingle();

  const person = (student as any)?.people;
  const name = person ? `${person.first_name} ${person.last_name}` : "Student";

  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Razorpay works in paise, and only in whole ones.
      amount: Math.round(Number(intent.amount) * 100),
      currency: "INR",
      accept_partial: false,
      description: `School fees — ${name} (${(student as any)?.admission_number ?? ""})`,
      customer: {
        name,
        contact: person?.phone ?? undefined,
        email: person?.email ?? undefined,
      },
      // The school sends the link itself; Razorpay is not asked to contact the
      // family, so no address of theirs is handed to a third party here.
      notify: { sms: false, email: false },
      reminder_enable: false,
      reference_id: intent.id,
      expire_by: expiresAt,
      notes: { intent_id: intent.id, tenant_id: intent.tenant_id },
    }),
  });

  const created = await response.json();
  if (!response.ok) {
    console.error("Razorpay refused the payment link", created);
    return json({ error: created?.error?.description ?? "Razorpay refused the request" }, 502);
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { error: writeError } = await admin
    .from("payment_intents")
    .update({
      provider_order_id: created.id,
      payment_url: created.short_url,
      status: "pending",
      expires_at: new Date(expiresAt * 1000).toISOString(),
    })
    .eq("id", intent.id)
    // Belt and braces: the caller's RLS already proved the tenant, and this
    // makes the write itself tenant-scoped rather than trusting that.
    .eq("tenant_id", intent.tenant_id);

  if (writeError) return json({ error: writeError.message }, 500);

  return json({ paymentUrl: created.short_url, orderId: created.id, reused: false });
});
