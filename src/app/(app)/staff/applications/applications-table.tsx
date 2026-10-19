"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, Loader2, RotateCcw, Star, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/providers/i18n-provider";
import { decideApplication, type ApplicationRow, type ApplicationStatus } from "./actions";

const EMPTY: Record<ApplicationStatus, string> = {
  new: "No new applications",
  shortlisted: "Nobody is shortlisted",
  hired: "Nobody has been hired from an application yet",
  rejected: "Nothing turned down",
};

export function ApplicationsTable({ rows, status }: { rows: ApplicationRow[]; status: ApplicationStatus }) {
  const { formatDate, formatNumber } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [rejecting, setRejecting] = useState<ApplicationRow | null>(null);

  function decide(row: ApplicationRow, next: "new" | "shortlisted") {
    setBusy(row.id);
    start(async () => {
      const r = await decideApplication(row.id, next);
      setBusy(null);
      if (!r.ok) return void toast.error(r.error);
      toast.success(next === "shortlisted" ? `${row.name} shortlisted` : `${row.name} moved back to New`);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card px-4 py-12 text-center">
        <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">{EMPTY[status]}</p>
        {status === "new" && (
          <p className="max-w-md text-sm text-muted-foreground">
            When somebody applies from the college&apos;s public jobs page, the application appears here.
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Applied</TableHead>
              <TableHead>Applicant</TableHead>
              <TableHead>Post</TableHead>
              <TableHead>Qualification</TableHead>
              <TableHead className="text-end">Experience</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>{status === "rejected" ? "Reason" : status === "hired" ? "Staff record" : "Action"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{formatDate(r.createdAt)}</TableCell>
                <TableCell>
                  <span className="font-medium">{r.name}</span>
                  {r.city && <div className="text-xs text-muted-foreground">{r.city}</div>}
                  {r.message && <p className="mt-1 max-w-72 text-xs whitespace-pre-line text-muted-foreground">{r.message}</p>}
                </TableCell>
                <TableCell>{r.position}</TableCell>
                <TableCell className="max-w-56">{r.qualification ?? "—"}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {r.experienceYears == null ? "—" : `${formatNumber(r.experienceYears)} yr`}
                </TableCell>
                <TableCell className="text-sm">
                  {r.phone && (
                    <a href={`tel:${r.phone}`} dir="ltr" className="block text-primary underline-offset-4 hover:underline">
                      {r.phone}
                    </a>
                  )}
                  {r.email && (
                    <a href={`mailto:${r.email}`} dir="ltr" className="block break-all text-primary underline-offset-4 hover:underline">
                      {r.email}
                    </a>
                  )}
                </TableCell>
                <TableCell>
                  {status === "new" || status === "shortlisted" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href={`/staff/new?application=${r.id}`}>
                          <UserPlus className="size-4" aria-hidden="true" />
                          Hire
                        </Link>
                      </Button>
                      {status === "new" ? (
                        <Button size="sm" variant="outline" onClick={() => decide(r, "shortlisted")} disabled={busy === r.id}>
                          {busy === r.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Star className="size-4" aria-hidden="true" />}
                          Shortlist
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => decide(r, "new")} disabled={busy === r.id}>
                          {busy === r.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
                          Back to New
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setRejecting(r)}>
                        <X className="size-4" aria-hidden="true" />
                        Turn down
                      </Button>
                    </div>
                  ) : status === "hired" && r.staffId ? (
                    <Link href={`/staff/${r.staffId}`} className="text-primary underline-offset-4 hover:underline">
                      Open record
                    </Link>
                  ) : status === "rejected" ? (
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-sm">{r.decisionNote ?? "—"}</span>
                      <Button size="sm" variant="ghost" onClick={() => decide(r, "new")} disabled={busy === r.id}>
                        <RotateCcw className="size-4" aria-hidden="true" />
                        Reopen
                      </Button>
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rejecting && <RejectDialog row={rejecting} onClose={() => setRejecting(null)} onDone={() => router.refresh()} />}
    </>
  );
}

function RejectDialog({ row, onClose, onDone }: { row: ApplicationRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function reject() {
    start(async () => {
      const r = await decideApplication(row.id, "rejected", reason);
      if (!r.ok) return setError(r.error);
      toast.success(`${row.name}'s application turned down`);
      onClose();
      onDone();
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Turn down {row.name}</DialogTitle>
          <DialogDescription>
            For the office only; the applicant is not sent this. It stays on the application, so the reason is there
            if the same person applies again.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea
            id="reject-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? "reject-error" : undefined}
          />
          {error && (
            <p id="reject-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={reject} disabled={pending || reason.trim().length < 3}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Turn down
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
