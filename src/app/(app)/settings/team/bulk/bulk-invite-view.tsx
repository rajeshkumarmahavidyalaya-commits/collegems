"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RoleOption } from "../actions";
import { applyList, buildList, discardList, editDecision, type RunView } from "./actions";

/**
 * Rule 13's preview, for invitations.
 *
 * Every row arrives as `invite` or `skip` **with the reason on it**, and none
 * of the skips is a refusal: an address can be typed in, and a person can
 * decide they want a second login for somebody who already has one. Doing
 * either records `is_override`, which is the difference between *"the rules
 * decided"* and *"the office decided"*.
 *
 * The three reasons the rules skip a row are each a fact the office would
 * otherwise discover one at a time, 555 times: no address, already has a login,
 * already invited.
 */
export function BulkInviteView({
  roles,
  sections,
  run,
}: {
  roles: RoleOption[];
  sections: { id: string; label: string }[];
  run: RunView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [roleId, setRoleId] = useState(roles.find((r) => r.code === "parent")?.id ?? roles[0]?.id ?? "");
  const [sectionId, setSectionId] = useState("");
  const [busyRow, setBusyRow] = useState<string | null>(null);

  function build() {
    startTransition(async () => {
      const result = await buildList(roleId, sectionId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function patch(id: string, p: Parameters<typeof editDecision>[1]) {
    setBusyRow(id);
    startTransition(async () => {
      const result = await editDecision(id, p);
      setBusyRow(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function apply() {
    if (!run) return;
    startTransition(async () => {
      const result = await applyList(run.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { invited, failed, emailed, texted, smsParts } = result.data;
      // Four facts, because "invited", "emailed" and "texted" are different
      // ones and a school that reads only the first comes to believe every
      // family was told. The SMS parts are the fifth, and only when they differ
      // from the number of texts — a school is billed per part, and quoting the
      // same number twice is noise.
      const parts = smsParts > texted ? ` (${smsParts} SMS parts)` : "";
      const said = `${invited} invited, ${emailed} emailed, ${texted} texted${parts}`;
      if (failed > 0) toast.warning(`${said}, ${failed} could not be invited — see the list.`);
      else toast.success(`${said}.`);
      router.refresh();
    });
  }

  if (!run) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Build a list</CardTitle>
          <CardDescription>
            Pick who the logins are for, and optionally one class. You will see every row before
            anything is sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="grid gap-2 sm:w-56">
              <Label htmlFor="bulk-role">Role</Label>
              <select
                id="bulk-role"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2 sm:w-64">
              <Label htmlFor="bulk-section">Class</Label>
              <select
                id="bulk-section"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Everybody in the school</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={build} disabled={pending || !roleId}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Users className="size-4" aria-hidden="true" />
              )}
              Build the list
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const invites = run.rows.filter((r) => r.decision === "invite");
  const skips = run.rows.filter((r) => r.decision === "skip");

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">
            {run.roleName} · {run.sectionLabel ?? "the whole school"}
          </CardTitle>
          <CardDescription>
            {invites.length} to invite, {skips.length} left out. Change anything before you send —
            an address can be typed in, and a row can be left out with a reason.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              startTransition(async () => {
                await discardList(run.id);
                router.refresh();
              })
            }
            disabled={pending}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Discard
          </Button>
          <Button onClick={apply} disabled={pending || invites.length === 0}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Invite {invites.length}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.rows.map((row) => (
                <TableRow key={row.id} className={row.decision === "skip" ? "opacity-70" : undefined}>
                  <TableCell className="font-medium break-words">
                    {row.fullName}
                    {row.isOverride && (
                      <Badge variant="outline" className="ms-2">
                        Changed by hand
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Email for ${row.fullName}`}
                      className="h-8 w-56"
                      defaultValue={row.email ?? ""}
                      disabled={row.applied}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== (row.email ?? "")) {
                          patch(row.id, { email: e.target.value });
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant={row.decision === "invite" ? "default" : "outline"}
                      size="sm"
                      disabled={row.applied || (pending && busyRow === row.id)}
                      onClick={() =>
                        patch(row.id, {
                          decision: row.decision === "invite" ? "skip" : "invite",
                          ...(row.decision === "invite" ? { reason: "Left out by the office" } : {}),
                        })
                      }
                    >
                      {row.decision === "invite" ? "Invite" : "Leave out"}
                    </Button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground break-words">
                    {row.error ? (
                      <span className="text-destructive">{row.error}</span>
                    ) : (
                      (row.reason ?? "—")
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
