"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  CopyPlus,
  Info,
  Loader2,
  PlayCircle,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/validations/fees";
import {
  DECISIONS,
  EVALUATION_ORDER,
  EXAM_KINDS_FOR_PROMOTION,
  ON_MISSING_RESULT,
  decisionLabel,
  decisionTone,
  type PromotionFormInput,
} from "@/lib/validations/promotion";
import {
  previewPromotion,
  rollForwardSections,
  startRun,
  type PreviewResult,
  type RunRow,
  type SessionOption,
} from "./actions";

type Props = {
  sessions: SessionOption[];
  runs: RunRow[];
};

export function PromotionPlanner({ sessions, runs }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const current = sessions.find((s) => s.isCurrent);
  const nextByDate = sessions.find((s) => !s.isCurrent && s.id !== current?.id);

  const [form, setForm] = useState<PromotionFormInput>({
    fromSessionId: current?.id ?? sessions[0]?.id ?? "",
    toSessionId: nextByDate?.id ?? "",
    noDetentionUpTo: "",
    requireExamPass: true,
    examKind: "annual",
    maxFailedSubjects: "0",
    minAttendancePercent: "",
    onMissingResult: "hold",
    carryForwardFees: true,
  });

  const toSession = sessions.find((s) => s.id === form.toSessionId);
  const liveRun = runs.find(
    (r) =>
      r.status === "draft" &&
      r.fromSessionName === sessions.find((s) => s.id === form.fromSessionId)?.name,
  );

  function set<K extends keyof PromotionFormInput>(key: K, value: PromotionFormInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setPreview(null);
  }

  function runPreview() {
    startTransition(async () => {
      const result = await previewPromotion(form);
      if (!result.ok) {
        toast.error(result.error);
        setPreview(null);
        return;
      }
      setPreview(result.data);
    });
  }

  function createRun() {
    startTransition(async () => {
      const result = await startRun(form);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Run created. Review it before applying.");
      router.push(`/promotion/${result.data.runId}`);
    });
  }

  function copySections() {
    startTransition(async () => {
      const result = await rollForwardSections(form.fromSessionId, form.toSessionId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.created === 0
          ? "Every class already exists in the receiving session."
          : `Created ${result.data.created} classes in the receiving session.`,
      );
      router.refresh();
    });
  }

  if (sessions.length < 2) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="rounded-full bg-muted p-3">
            <CalendarPlus className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <div>
            <p className="font-medium">There is only one academic session</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              A promotion run moves students from one session into another, so the receiving year
              has to exist first. Create it under Academics, then come back.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const summary = preview
    ? DECISIONS.map((d) => ({
        ...d,
        count: preview.rows.filter((r) => r.decision === d.value).length,
      })).filter((d) => d.count > 0)
    : [];

  const leaversOwing = preview
    ? preview.rows
        .filter((r) => r.decision === "graduate" && r.outstanding > 0)
        .reduce((sum, r) => sum + r.outstanding, 0)
    : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Which years</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from-session">Promote from</Label>
              <Select value={form.fromSessionId} onValueChange={(v) => set("fromSessionId", v)}>
                <SelectTrigger id="from-session">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.isCurrent ? " · current" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to-session">Promote into</Label>
              <Select value={form.toSessionId} onValueChange={(v) => set("toSessionId", v)}>
                <SelectTrigger id="to-session">
                  <SelectValue placeholder="Choose the receiving year" />
                </SelectTrigger>
                <SelectContent>
                  {sessions
                    .filter((s) => s.id !== form.fromSessionId)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · {s.sectionCount}{" "}
                        {s.sectionCount === 1 ? "class" : "classes"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {toSession && toSession.sectionCount === 0 && (
              <Alert>
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>The receiving year has no classes</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-2">
                  Classes are per-year, so next year&rsquo;s 6B is a different record. Without them
                  every student would be held.
                  <Button variant="outline" size="sm" onClick={copySections} disabled={pending}>
                    <CopyPlus className="size-4" aria-hidden="true" />
                    Copy this year&rsquo;s classes across
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">The rules</CardTitle>
            <CardDescription>
              Consulted in this order, which is why a child can be promoted despite failing.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs text-muted-foreground">
              {EVALUATION_ORDER.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="no-detention">No-detention up to class sequence</Label>
              <Input
                id="no-detention"
                type="number"
                min={1}
                value={form.noDetentionUpTo}
                onChange={(e) => set("noDetentionUpTo", e.target.value)}
                placeholder="Leave empty for none"
              />
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="require-pass"
                checked={form.requireExamPass}
                onCheckedChange={(state) => set("requireExamPass", state === true)}
              />
              <div className="grid gap-0.5 leading-tight">
                <Label htmlFor="require-pass">Promotion depends on an examination</Label>
                <span className="text-xs text-muted-foreground">
                  Only a <span className="font-medium">published</span> result counts — a draft is a
                  number still being argued about.
                </span>
              </div>
            </div>

            {form.requireExamPass && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="exam-kind">Which examination decides</Label>
                  <Select value={form.examKind} onValueChange={(v) => set("examKind", v)}>
                    <SelectTrigger id="exam-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXAM_KINDS_FOR_PROMOTION.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="max-failed">Failed subjects still allowed through</Label>
                  <Input
                    id="max-failed"
                    type="number"
                    min={0}
                    value={form.maxFailedSubjects}
                    onChange={(e) => set("maxFailedSubjects", e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="min-attendance">Minimum attendance (%)</Label>
              <Input
                id="min-attendance"
                type="number"
                min={0}
                max={100}
                value={form.minAttendancePercent}
                onChange={(e) => set("minAttendancePercent", e.target.value)}
                placeholder="Leave empty for none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="on-missing">When there is no result</Label>
              <Select
                value={form.onMissingResult}
                onValueChange={(v) => set("onMissingResult", v as PromotionFormInput["onMissingResult"])}
              >
                <SelectTrigger id="on-missing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ON_MISSING_RESULT.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ON_MISSING_RESULT.find((o) => o.value === form.onMissingResult)?.hint}
              </p>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="carry-fees"
                checked={form.carryForwardFees}
                onCheckedChange={(state) => set("carryForwardFees", state === true)}
              />
              <div className="grid gap-0.5 leading-tight">
                <Label htmlFor="carry-fees">Carry unpaid balances forward</Label>
                <span className="text-xs text-muted-foreground">
                  Raises an opening invoice in the receiving year, so the debt arrives as a document
                  rather than a number.
                </span>
              </div>
            </div>

            <Button onClick={runPreview} disabled={pending || !form.toSessionId}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <PlayCircle className="size-4" aria-hidden="true" />
              )}
              Preview
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {preview && preview.problems.length > 0 && (
          <Alert>
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>Worth a look at these rules</AlertTitle>
            <AlertDescription>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {preview.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {preview ? (
          <Card>
            <CardHeader>
              <CardTitle>Dry run</CardTitle>
              <CardDescription>
                Nothing has been written. {preview.rows.length} students in the outgoing year.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {summary.map((d) => (
                  <div key={d.value} className="rounded-lg border p-3">
                    <p className="font-mono text-2xl font-semibold tabular-nums">{d.count}</p>
                    {/* The word, always — a count under a colour swatch is not a
                        label anybody can read aloud. */}
                    <p className="text-sm font-medium">{d.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{d.hint}</p>
                  </div>
                ))}
              </div>

              {leaversOwing > 0 && (
                <Alert>
                  <Info className="size-4" aria-hidden="true" />
                  <AlertTitle>
                    {formatMoney(leaversOwing)} is owed by students who are leaving
                  </AlertTitle>
                  <AlertDescription>
                    A graduate gets no enrolment in the receiving year, so there is nothing to carry
                    a balance onto. That debt stays on the outgoing year&rsquo;s ledger and is not
                    written off — collecting it is a decision somebody has to make deliberately.
                  </AlertDescription>
                </Alert>
              )}

              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Promotion dry run</caption>
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th scope="col" className="px-3 py-2 font-medium">Student</th>
                      <th scope="col" className="px-3 py-2 font-medium">From</th>
                      <th scope="col" className="px-3 py-2 font-medium">Decision</th>
                      <th scope="col" className="px-3 py-2 font-medium">Into</th>
                      <th scope="col" className="px-3 py-2 font-medium">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 40).map((row) => (
                      <tr key={row.studentId} className="border-b last:border-0">
                        <td className="px-3 py-1.5">
                          <span className="font-medium">{row.studentName}</span>
                          <span className="block font-mono text-xs text-muted-foreground">
                            {row.admissionNumber}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {row.fromSectionLabel}
                        </td>
                        <td className="px-3 py-1.5">
                          <DecisionBadge decision={row.decision} />
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {row.toSectionLabel ?? "—"}
                        </td>
                        <td className="max-w-md px-3 py-1.5 text-xs text-muted-foreground">
                          {row.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {preview.rows.length > 40 && (
                <p className="text-sm text-muted-foreground">
                  Showing the first 40. Start a run to see and edit all{" "}
                  {preview.rows.length}.
                </p>
              )}

              {liveRun ? (
                <Alert>
                  <Info className="size-4" aria-hidden="true" />
                  <AlertTitle>There is already a run for this rollover</AlertTitle>
                  <AlertDescription className="flex flex-col items-start gap-2">
                    Two half-built previews of the same rollover would disagree, and whichever was
                    applied second would silently win.
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/promotion/${liveRun.id}`}>Open it</Link>
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : (
                <Button onClick={createRun} disabled={pending} className="self-start">
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowRight className="size-4" aria-hidden="true" />
                  )}
                  Start a run from these rules
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="rounded-full bg-muted p-3">
                <Users className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium">Nothing previewed yet</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Set the rules and press Preview. Nothing is written until you start a run, and a
                  run is not applied until you say so — so this is safe to experiment with.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {runs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Runs</CardTitle>
              <CardDescription>An applied run is history and cannot be undone here.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {runs.map((run) => (
                <Link
                  key={run.id}
                  href={`/promotion/${run.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium">
                    {run.fromSessionName} → {run.toSessionName}
                  </span>
                  <Badge variant={run.status === "applied" ? "default" : "outline"}>
                    {run.status === "applied" ? "Applied" : "Draft"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {Object.entries(run.counts)
                      .map(([k, v]) => `${v} ${decisionLabel(k).toLowerCase()}`)
                      .join(" · ")}
                  </span>
                  {run.overrides > 0 && (
                    <Badge variant="outline" className="font-normal">
                      {run.overrides} overridden
                    </Badge>
                  )}
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export function DecisionBadge({ decision }: { decision: string }) {
  const tone = decisionTone(decision);
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-normal",
        tone === "success" && "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
        tone === "warning" && "border-amber-600/40 text-amber-700 dark:text-amber-400",
        tone === "info" && "border-sky-600/40 text-sky-700 dark:text-sky-400",
      )}
    >
      {decision === "promote" && <CheckCircle2 className="size-3" aria-hidden="true" />}
      {decisionLabel(decision)}
    </Badge>
  );
}
