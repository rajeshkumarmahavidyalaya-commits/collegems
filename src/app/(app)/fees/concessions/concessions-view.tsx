"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/validations/fees-display";
import {
  concessionSentence,
  kindLabel,
  statusLabel,
  statusTone,
} from "@/lib/validations/concessions";
import {
  awardConcession,
  createConcession,
  revokeConcession,
  type AwardRow,
  type ConcessionRow,
} from "./actions";

type Student = { id: string; name: string; admissionNumber: string };

export function ConcessionsView({
  concessions,
  awards,
  students,
  canManage,
}: {
  concessions: ConcessionRow[];
  awards: AwardRow[];
  students: Student[];
  canManage: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [awarding, setAwarding] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="catalogue-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="catalogue-heading" className="text-lg font-semibold">
            What this school offers
          </h2>
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              New concession
            </Button>
          )}
        </div>

        {concessions.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {concessions.map((c) => (
              <li key={c.id}>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {c.name}
                      <Badge variant="outline">{kindLabel(c.kind)}</Badge>
                      {!c.isActive && <Badge variant="secondary">Switched off</Badge>}
                    </CardTitle>
                    <CardDescription>
                      <span className="font-medium text-foreground">
                        {concessionSentence({
                          kind: c.kind,
                          value: c.value,
                          maxAmount: c.maxAmount,
                        })}
                      </span>
                      {" · "}
                      {c.awardCount === 0
                        ? "nobody holds it"
                        : `${c.awardCount} ${c.awardCount === 1 ? "child holds it" : "children hold it"}`}
                      {c.feeHeadIds.length > 0 && " · some fee heads only"}
                    </CardDescription>
                  </CardHeader>
                  {c.description && (
                    <CardContent className="pt-0 text-sm text-muted-foreground">
                      {c.description}
                    </CardContent>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="awards-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="awards-heading" className="text-lg font-semibold">
            Who holds one
          </h2>
          {canManage && concessions.some((c) => c.isActive) && (
            <Button size="sm" variant="outline" onClick={() => setAwarding(true)}>
              <UserPlus className="size-3.5" aria-hidden="true" />
              Award to a student
            </Button>
          )}
        </div>

        {awards.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nobody yet</CardTitle>
              <CardDescription>
                Awards appear here as soon as one is granted, with what it has credited so far.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {awards.map((a) => (
              <li key={a.id}>
                <AwardCard award={a} canManage={canManage} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <NewConcessionDialog open={creating} onOpenChange={setCreating} />
      <AwardDialog
        open={awarding}
        onOpenChange={setAwarding}
        concessions={concessions.filter((c) => c.isActive)}
        students={students}
      />
    </div>
  );
}

function AwardCard({ award, canManage }: { award: AwardRow; canManage: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function withdraw() {
    startTransition(async () => {
      const result = await revokeConcession({ awardId: award.id, reason });
      if (result.ok) {
        toast.success("Withdrawn. Money already credited stays credited.");
        setConfirming(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {award.student}
              <span className="font-mono text-xs text-muted-foreground">
                {award.admissionNumber}
              </span>
              <Badge variant={statusTone(award.status)}>{statusLabel(award.status)}</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              {award.concession} &middot; from {award.grantedOn}
              {award.endsOn ? ` to ${award.endsOn}` : ""} &middot; credited{" "}
              <span className="font-medium text-foreground">{formatMoney(award.credited)}</span>
            </CardDescription>
          </div>

          {canManage && award.status === "active" && (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              <X className="size-3.5" aria-hidden="true" />
              Withdraw
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0 text-sm text-muted-foreground">
        {award.reason}
        {award.revokeReason && (
          <p className="mt-1 text-foreground">Withdrawn: {award.revokeReason}</p>
        )}
      </CardContent>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw {award.concession}?</DialogTitle>
            <DialogDescription>
              This stops the concession applying to future invoices. It does not undo anything
              already credited &mdash; the ledger is a record of what happened, and this concession
              did apply when it applied.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`revoke-${award.id}`}>Why</Label>
            <Textarea
              id={`revoke-${award.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Elder sibling has left the school"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={withdraw} disabled={pending || reason.trim().length < 3}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function NewConcessionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    kind: "percentage",
    value: "",
    maxAmount: "",
    priority: "100",
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    startTransition(async () => {
      const result = await createConcession({
        code: form.code.toUpperCase(),
        name: form.name,
        description: form.description || undefined,
        kind: form.kind,
        value: Number(form.value),
        maxAmount: form.kind === "percentage" && form.maxAmount ? Number(form.maxAmount) : null,
        priority: Number(form.priority) || 100,
        feeHeadIds: [],
      });
      if (result.ok) {
        toast.success("Created. Award it to the children who qualify.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New concession</DialogTitle>
          <DialogDescription>
            What the school offers, not who gets it. Awarding comes next.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-code">Code</Label>
            <Input
              id="c-code"
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              placeholder="SIBLING"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Sibling discount"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-kind">Kind</Label>
            <Select value={form.kind} onValueChange={(v) => set("kind", v)}>
              <SelectTrigger id="c-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Percentage</SelectItem>
                <SelectItem value="amount">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-value">{form.kind === "percentage" ? "Per cent" : "Amount"}</Label>
            <Input
              id="c-value"
              type="number"
              value={form.value}
              onChange={(e) => set("value", e.target.value)}
              placeholder={form.kind === "percentage" ? "10" : "1000"}
            />
          </div>
          {form.kind === "percentage" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-max">Ceiling (optional)</Label>
              <Input
                id="c-max"
                type="number"
                value={form.maxAmount}
                onChange={(e) => set("maxAmount", e.target.value)}
                placeholder="2000"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-priority">Order</Label>
            <Input
              id="c-priority"
              type="number"
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="c-desc">Description (optional)</Label>
          <Textarea
            id="c-desc"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Second and subsequent children of one family"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Order decides which concession is honoured first when several together would come to
          more than the bill. Lower runs first.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !form.code || !form.name || !form.value}>
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AwardDialog({
  open,
  onOpenChange,
  concessions,
  students,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concessions: ConcessionRow[];
  students: Student[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [studentId, setStudentId] = useState("");
  const [concessionId, setConcessionId] = useState("");
  const [reason, setReason] = useState("");
  const [endsOn, setEndsOn] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await awardConcession({
        studentId,
        concessionId,
        reason,
        endsOn: endsOn || null,
      });
      if (result.ok) {
        toast.success("Awarded. It comes off the next invoice.");
        onOpenChange(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Award a concession</DialogTitle>
          <DialogDescription>
            To one named child, for a stated reason. Both go in the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-student">Student</Label>
          <Select value={studentId} onValueChange={setStudentId}>
            <SelectTrigger id="a-student">
              <SelectValue placeholder="Choose a student" />
            </SelectTrigger>
            <SelectContent>
              {students.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} · {s.admissionNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-concession">Concession</Label>
          <Select value={concessionId} onValueChange={setConcessionId}>
            <SelectTrigger id="a-concession">
              <SelectValue placeholder="Choose a concession" />
            </SelectTrigger>
            <SelectContent>
              {concessions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ·{" "}
                  {concessionSentence({ kind: c.kind, value: c.value, maxAmount: c.maxAmount })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-reason">Why</Label>
          <Textarea
            id="a-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Elder brother in Grade 9"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-ends">Ends on (optional)</Label>
          <Input
            id="a-ends"
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to run for the rest of the academic year.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !studentId || !concessionId || reason.trim().length < 3}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            Award
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
