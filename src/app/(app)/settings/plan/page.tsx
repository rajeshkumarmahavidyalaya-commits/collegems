import { CircleAlert, ExternalLink, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/server";
import { hasPermission } from "@/lib/auth/permissions";
import { UpgradeButton } from "./upgrade-button";

export const metadata = { title: "Plan" };

type Usage = { resource: string; used: number; allowed: number | null; over: boolean };
type Plan = {
  code: string;
  name: string;
  description: string;
  price_minor: number | null;
  bill_every: string;
  limits: Record<string, number>;
  /** Has an id at the payment provider, so a checkout can be started (0217). */
  purchasable?: boolean;
};

/** The college's own open checkout, if it has one. At most one exists. */
type Checkout = {
  id: string;
  plan_code: string;
  status: string;
  checkout_url: string | null;
  expires_at: string;
};
type Overview = {
  subscription: {
    plan_code: string;
    status: string;
    trial_ends_on: string | null;
    current_period_end: string | null;
  } | null;
  plan: Plan | null;
  usage: Usage[];
  available: Plan[];
  checkout: Checkout | null;
};

const RESOURCE_LABEL: Record<string, string> = {
  students: "Children on the roll",
  staff: "Staff",
};

export default async function PlanPage() {
  const supabase = await createClient();
  const locale = await getLocale();

  // One round trip. It is a glance, not a lookup — rule 11's dashboard shape.
  const { data } = await supabase.rpc("subscription_overview");
  const overview = (data ?? {}) as Partial<Overview>;
  const sub = overview.subscription ?? null;
  const plan = overview.plan ?? null;
  const rows = overview.usage ?? [];
  const available = overview.available ?? [];
  const checkout = overview.checkout ?? null;

  // `users.manage`, the same permission subscription_start_checkout checks —
  // committing a college to a monthly charge is the same kind of act as
  // deciding who may sign in. It is not the gate: that function is DEFINER over
  // a table with no write policy and does its own check, so a teacher pressing
  // this is refused by Postgres.
  const canBuy = await hasPermission("users.manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Plan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What this school is on, and what it is using.
        </p>
      </div>

      {!sub ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="rounded-full bg-muted p-3">
              <CircleAlert className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium">This school has no plan on record</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Nothing is limited and nothing is billed. Get in touch and we will put one in place.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {plan?.name ?? sub.plan_code}
              {/* Status is a word, never a colour on its own. */}
              <Badge variant={sub.status === "active" ? "default" : "outline"}>{sub.status}</Badge>
            </CardTitle>
            <CardDescription>{plan?.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {plan?.price_minor != null && plan.price_minor > 0 && (
              <p>
                <span className="font-mono tabular-nums">
                  {formatCurrency(plan.price_minor / 100, locale)}
                </span>{" "}
                <span className="text-muted-foreground">per {plan.bill_every}</span>
              </p>
            )}
            {sub.status === "trialing" && sub.trial_ends_on && (
              <p className="text-muted-foreground">
                Trial ends {formatDate(`${sub.trial_ends_on}T00:00:00Z`, locale)}.
              </p>
            )}
            {sub.current_period_end && (
              <p className="text-muted-foreground">
                Renews {formatDate(`${sub.current_period_end}T00:00:00Z`, locale)}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage</CardTitle>
          <CardDescription>
            Counted live from the roll, not from anything stored — so this and the admission desk
            cannot disagree.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to count yet.</p>
          ) : (
            rows.map((r) => {
              // Three states, and none may be shown as another: no ceiling is
              // not a ceiling of zero, and it is not "unused" either.
              const unlimited = r.allowed === null;
              const pct = unlimited ? 0 : Math.min(100, Math.round((r.used / r.allowed!) * 100));
              return (
                <div key={r.resource} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                      {RESOURCE_LABEL[r.resource] ?? r.resource}
                    </span>
                    <span className="font-mono text-sm tabular-nums">
                      {r.used}
                      {unlimited ? (
                        <span className="text-muted-foreground"> · no limit</span>
                      ) : (
                        <span className="text-muted-foreground"> of {r.allowed}</span>
                      )}
                    </span>
                  </div>
                  {!unlimited && (
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${RESOURCE_LABEL[r.resource] ?? r.resource}: ${r.used} of ${r.allowed}`}
                    >
                      <div
                        className={`h-full rounded-full ${r.over || pct >= 100 ? "bg-destructive" : "bg-primary"}`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  )}
                  {r.over && (
                    <p className="text-xs text-destructive">
                      Over the limit. Existing records are untouched; new ones are refused until the
                      plan changes.
                    </p>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {checkout && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">A change is part-way through</CardTitle>
            <CardDescription>
              {/* Shown rather than silently superseded: starting again is
                  allowed and supersedes this one, but somebody who left a
                  payment page open in another tab should be given it back
                  rather than made to create a second subscription. */}
              Somebody asked to move this college to{" "}
              <span className="font-medium">{checkout.plan_code}</span>. Nothing has been charged
              yet.
            </CardDescription>
          </CardHeader>
          {checkout.checkout_url && (
            <CardContent>
              <a
                href={checkout.checkout_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open the payment page
              </a>
            </CardContent>
          )}
        </Card>
      )}

      {available.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Other plans</CardTitle>
            <CardDescription>
              {/* Was "not self-serve yet", which was honest while nothing could
                  take the money. Migration 0214 built the half that can, so the
                  sentence had to move with it — and a plan with no id at the
                  provider still draws no button rather than one that refuses. */}
              Moving to a paid plan opens a payment page. Nothing changes until the first payment
              clears.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {available.map((p) => (
              <div
                key={p.code}
                className={`rounded-lg border p-4 ${
                  p.code === sub?.plan_code ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <p className="flex items-center gap-2 text-sm font-medium">
                  {p.name}
                  {p.code === sub?.plan_code && (
                    <Badge variant="secondary" className="text-xs">
                      Current
                    </Badge>
                  )}
                </p>
                <p className="mt-1 font-mono text-sm tabular-nums">
                  {p.price_minor ? formatCurrency(p.price_minor / 100, locale) : "Free"}
                  {p.price_minor ? (
                    <span className="text-muted-foreground"> /{p.bill_every}</span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>

                {canBuy && p.code !== sub?.plan_code && (
                  <UpgradeButton
                    planCode={p.code}
                    planName={p.name}
                    purchasable={p.purchasable === true}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
