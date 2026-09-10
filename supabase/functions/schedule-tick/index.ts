import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Runs everything that is due, in every school's own wall clock.
 *
 * This function is deliberately thin. All of the judgement — which occurrences
 * have arrived, whether one is too late to be worth sending, who should hear
 * about it, and what the message says — is in Postgres, in `schedules_tick`.
 * What lives here is the one thing Postgres cannot do: be woken up.
 *
 * WHY IT IS NOT A CRON EXPRESSION PER SCHOOL
 *
 * A cron expression fires in one timezone. Two schools on one deployment do not
 * share one, and a school that keeps `Asia/Kolkata` does not want its evening
 * SMS at two in the afternoon because the server keeps UTC. So this is woken
 * *often* — every fifteen minutes is plenty — and asks the database which
 * schools' clocks have passed which of their own schedules. The frequency of
 * the wake-up has nothing to do with the frequency of any schedule.
 *
 * SERVICE ROLE ONLY, AND ON PURPOSE
 *
 * `schedules_tick` takes no tenant and touches every school, so it is revoked
 * from `public`, `anon` and `authenticated` — nothing holding a JWT may call
 * it. Deployed WITHOUT JWT verification would make this URL a way for anybody
 * to make every school's messages go out early, so it is deployed WITH it and
 * additionally refuses any caller whose token is not the service role. There is
 * no per-tenant mode here: "send my school's queued messages now" is the
 * dispatcher's button, not this one's.
 *
 * BOUNDED, per rule 7, twice over. At most `MAX_OCCURRENCES` occurrences or
 * `BUDGET_MS` per invocation, and `schedules_tick` itself caps how many people
 * one occurrence may tell. The reply says how many occurrences are still
 * waiting, so a backlog is this function called twice rather than a request
 * that times out.
 */

const BATCH = 10;
const MAX_OCCURRENCES = 60;
const MAX_RECIPIENTS_PER_RUN = 500;
const BUDGET_MS = 40_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type TickResult = {
  ran: number;
  missed: number;
  failed: number;
  notified: number;
  remaining: number;
  limit: number;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !url) {
    return json({ error: "The function is missing its Supabase credentials" }, 500);
  }

  // The gateway has already verified the signature. What is checked here is
  // *which* token it was: anything but the service role is refused outright,
  // because this function has no tenant to scope itself to.
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token !== serviceKey) {
    return json({ error: "This function may only be called by the scheduler" }, 403);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const started = Date.now();
  const totals = { ran: 0, missed: 0, failed: 0, notified: 0 };
  let remaining = 0;

  // Platform housekeeping, before the per-school work.
  //
  // A trial ending is a fact about a date with nobody's authority in it, which
  // is rule 7's test for something a scheduler may do. It lives here rather
  // than in a Postgres cron job for the reason this function already exists:
  // one thing that gets woken up, so there is one place to look when something
  // did not run.
  //
  // It is one UPDATE over a table with a row per school, so it is bounded by
  // the number of customers and needs no batching. Its failure is reported and
  // NOT fatal -- a provider outage on the housekeeping must not stop four
  // hundred parents being told their children were absent.
  let trialsExpired = 0;
  let housekeepingError: string | null = null;
  {
    const { data, error } = await supabase.rpc("subscription_expire_trials");
    if (error) {
      housekeepingError = error.message;
      console.error("[schedule-tick] could not expire trials:", error.message);
    } else {
      trialsExpired = (data as number) ?? 0;
    }
  }

  while (totals.ran < MAX_OCCURRENCES && Date.now() - started < BUDGET_MS) {
    const { data, error } = await supabase.rpc("schedules_tick", {
      p_limit: BATCH,
      p_max_recipients: MAX_RECIPIENTS_PER_RUN,
    });

    if (error) {
      // Report what was already done rather than losing it. A partial pass that
      // says so is worth more than a 500 that hides the fact that four hundred
      // parents were told.
      return json({ ...totals, remaining, error: error.message }, 500);
    }

    const result = data as TickResult;
    totals.ran += result.ran;
    totals.missed += result.missed;
    totals.failed += result.failed;
    totals.notified += result.notified;
    remaining = result.remaining;

    // Nothing was due, so there is nothing to come back for in this invocation.
    if (result.ran === 0) break;
  }

  return json({
    ...totals,
    remaining,
    trials_expired: trialsExpired,
    // Reported rather than swallowed. A run that could not expire a trial is
    // still a successful run for the schedules, and conflating the two is how
    // a school stays on a free trial for a year without anybody noticing.
    ...(housekeepingError ? { housekeeping_error: housekeepingError } : {}),
    // Said out loud, so the caller knows whether to invoke again rather than
    // guessing from a count that could mean either.
    truncated: remaining > 0,
    elapsed_ms: Date.now() - started,
  });
});
