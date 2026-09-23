import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * An attendance reader's punches -> `public.biometric_punches` and the staff
 * register (migration 0273).
 *
 *   POST /functions/v1/biometric-punch
 *   Authorization: Bearer <the secret shown once when the reader was registered>
 *   { "device_id": "<uuid>", "punches": [{ "code": "17", "at": "2026-09-23T09:02:11+05:30" }] }
 *
 * Deployed with JWT verification OFF, because a reader cannot present one. The
 * device's own secret is the whole authentication, and it is checked **in
 * Postgres** -- `biometric_ingest` compares its SHA-256 against the row this
 * system wrote -- so this function holds no secret of its own beyond the
 * service key, and decides nothing: not the tenant (the device row says it),
 * not who a code is (the staff table says it), not what the register says (the
 * function refuses to overwrite a row a person marked).
 *
 * Every refusal about the device is one sentence and one status, 401, whether
 * the id is unknown, retired or the secret is wrong, so the endpoint is not a
 * way to ask which device ids exist.
 *
 * Send `at` with its offset. A time without one is read as UTC, which is five
 * and a half hours from a reader in Kolkata -- and the function would file the
 * punch as the wrong time of day, not refuse it.
 */

const MAX_BODY_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Postgres error codes `biometric_ingest` raises on purpose, as HTTP. */
const STATUS_FOR: Record<string, number> = {
  "28000": 401, // not this device, or not its secret
  "22023": 400, // punches is not an array
  "54000": 413, // more than 500 punches in one batch
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  const secret = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!secret) return json({ error: "Send the reader's secret as: Authorization: Bearer <secret>" }, 401);

  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return json({ error: "Too large; send at most 500 punches at a time." }, 413);

  let body: { device_id?: unknown; punches?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "Too large; send at most 500 punches at a time." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "The body is not JSON." }, 400);
  }

  if (typeof body?.device_id !== "string" || !UUID.test(body.device_id)) {
    return json({ error: "device_id must be the reader's id, as shown when it was registered." }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await admin.rpc("biometric_ingest", {
    p_device_id: body.device_id,
    p_secret: secret,
    p_punches: body.punches ?? null,
  });

  if (error) {
    const status = STATUS_FOR[error.code ?? ""];
    if (status) return json({ error: error.message }, status);
    // Anything else is ours, not the reader's; do not echo internals to it.
    console.error("biometric_ingest failed", error.code, error.message);
    return json({ error: "The punches could not be recorded. Send them again later." }, 500);
  }

  return json(data);
});
