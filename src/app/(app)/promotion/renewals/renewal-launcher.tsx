"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BedDouble, Bus, CopyPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RENEWAL_KINDS, renewalKindLabel, type RenewalRunRow } from "@/lib/validations/renewals";
import { rollForwardRoutes, startRenewalRun } from "./actions";

type Props = {
  sessions: { id: string; name: string; isCurrent: boolean }[];
  runs: RenewalRunRow[];
};

/**
 * Starting a renewal, on the rollover screen.
 *
 * Deliberately here rather than on the transport or hostel page: a bus seat
 * that ends in March is not a transport problem in July, and the person who can
 * act on it is the one already standing in front of the year change. Same
 * argument as `academics_session_problems()` being read here.
 */
export function RenewalLauncher({ sessions, runs }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const current = sessions.find((s) => s.isCurrent) ?? sessions[0];
  const later = sessions.filter((s) => s.id !== current?.id);

  const [fromId, setFromId] = useState(current?.id ?? "");
  const [toId, setToId] = useState(later[0]?.id ?? "");

  function copyRoutes() {
    startTransition(async () => {
      const result = await rollForwardRoutes(fromId, toId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { routes, stops, skipped } = result.data;
      toast.success(
        routes === 0 && stops === 0
          ? "Every route and stop already exists in the receiving year."
          : `Copied ${routes} ${routes === 1 ? "route" : "routes"} and ${stops} ${stops === 1 ? "stop" : "stops"}.` +
              (skipped > 0
                ? ` ${skipped} could not be copied — that position is already taken on the receiving route.`
                : ""),
      );
      router.refresh();
    });
  }

  function start(kind: string) {
    startTransition(async () => {
      const result = await startRenewalRun(fromId, toId, kind);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push(`/promotion/renewals/${result.data.runId}`);
    });
  }

  if (sessions.length < 2) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Carrying arrangements forward</CardTitle>
        <CardDescription>
          A bus seat, a hostel bed and a fee concession all belong to one academic year and end with
          it. Promoting a child does not carry them — a concession never will, because an award is
          granted by a person for a reason. These two can be.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="renew-from">From</Label>
            <Select value={fromId} onValueChange={setFromId}>
              <SelectTrigger id="renew-from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="renew-to">Into</Label>
            <Select value={toId} onValueChange={setToId}>
              <SelectTrigger id="renew-to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sessions
                  .filter((s) => s.id !== fromId)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <p className="text-sm font-medium">Routes and stops are per-year too</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Without them not one seat can be assigned for the new year. Fares come across as last
            year&rsquo;s — a starting point to edit, not an answer.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={copyRoutes}
            disabled={pending || !fromId || !toId}
          >
            <CopyPlus className="size-4" aria-hidden="true" />
            Copy routes and stops across
          </Button>
        </div>

        <ul className="flex flex-col gap-2">
          {RENEWAL_KINDS.map((kind) => {
            const live = runs.find(
              (r) => r.kind === kind.value && r.status === "draft" && r.toSessionName,
            );
            // A bus for a bus and a bed for a bed. The icon is the fastest thing
            // on the card to read, so the wrong one is worse than none.
            const Icon = kind.value === "transport" ? Bus : BedDouble;
            return (
              <li key={kind.value} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                      {kind.label}
                      {live && <Badge variant="outline">Draft open</Badge>}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{kind.blurb}</p>
                  </div>
                  {live ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/promotion/renewals/${live.id}`}>
                        Review draft
                        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => start(kind.value)}
                      disabled={pending || !fromId || !toId}
                    >
                      {pending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
                      )}
                      Preview
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {runs.filter((r) => r.status === "applied").length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Applied</p>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {runs
                .filter((r) => r.status === "applied")
                .map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/promotion/renewals/${r.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {renewalKindLabel(r.kind)} · {r.fromSessionName} → {r.toSessionName} ·{" "}
                      {r.counts.renew} carried
                      {r.failures > 0 && `, ${r.failures} refused`}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
