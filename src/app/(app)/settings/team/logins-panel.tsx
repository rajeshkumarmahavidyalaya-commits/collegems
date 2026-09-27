"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/components/providers/i18n-provider";
import { setLoginAccess, setLoginRole, type LoginRow } from "./login-actions";
import type { RoleOption } from "./actions";

const RECORD_LABEL: Record<string, string> = {
  staff: "Staff",
  guardian: "Parent",
  student: "Student",
  none: "No record",
};

/**
 * Who can sign in, and the two things an office does to a login: change what
 * it is for, and switch it off (0289).
 *
 * A role is offered only when this login's record can satisfy it -- a teacher
 * cannot become a Parent, because a Parent login must name a guardian and the
 * database would refuse it anyway. Offering a control that will refuse you is
 * worse than not offering it.
 */
export function LoginsPanel({ logins, roles }: { logins: LoginRow[]; roles: RoleOption[] }) {
  const router = useRouter();
  const { formatDate } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const active = logins.filter((l) => l.active).length;

  function rolesFor(login: LoginRow) {
    return roles.filter((r) =>
      r.id === login.roleId ||
      r.subject === "none"
        ? true
        : r.subject === "staff"
          ? login.recordKind === "staff"
          : r.subject === "guardian"
            ? login.recordKind === "guardian"
            : login.recordKind === "student",
    );
  }

  function changeRole(login: LoginRow, roleId: string) {
    if (roleId === login.roleId) return;
    const role = roles.find((r) => r.id === roleId);
    if (
      !window.confirm(
        `Make ${login.name} a ${role?.name ?? "different role"}? They will be signed out and see the new role when they sign back in.`,
      )
    ) {
      return;
    }
    setBusy(login.userId);
    startTransition(async () => {
      const result = await setLoginRole(login.userId, roleId);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.name} is now ${result.data.role}.`);
      router.refresh();
    });
  }

  function toggle(login: LoginRow) {
    const off = login.active;
    if (
      off &&
      !window.confirm(
        `Switch off ${login.name}'s login? They are signed out and cannot sign back in until it is switched on again. Nothing of theirs is deleted.`,
      )
    ) {
      return;
    }
    setBusy(login.userId);
    startTransition(async () => {
      const result = await setLoginAccess(login.userId, !off);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        off
          ? `${result.data.name} can no longer sign in.`
          : `${result.data.name} can sign in again.`,
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who can sign in</CardTitle>
        <CardDescription>
          {active === 1 ? "1 login is" : `${active} logins are`} active. A member of staff who is
          recorded as having left is switched off automatically; switching a login back on is
          always a decision made here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {logins.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody has signed up yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">Person</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">Role</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">Last signed in</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">Access</th>
                </tr>
              </thead>
              <tbody>
                {logins.map((l) => (
                  <tr key={l.userId} className="border-t align-top">
                    <td className="px-3 py-2">
                      <span className="font-medium">{l.name}</span>
                      {l.isYou && <Badge variant="outline" className="ms-2">You</Badge>}
                      <span className="block break-all text-xs text-muted-foreground">
                        {l.email} · {RECORD_LABEL[l.recordKind] ?? l.recordKind}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {l.isYou ? (
                        <span>{l.roleName}</span>
                      ) : (
                        // A native select, deliberately: Radix Select cost this
                        // route 30 kB for one picker per row.
                        <select
                          value={l.roleId}
                          onChange={(e) => changeRole(l, e.target.value)}
                          disabled={busy === l.userId}
                          aria-label={`Role for ${l.name}`}
                          className="h-8 w-44 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          {rolesFor(l).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {l.lastSignInAt ? formatDate(l.lastSignInAt) : "Never"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={l.active ? "success" : "secondary"}>
                          {l.active ? "Can sign in" : "Switched off"}
                        </Badge>
                        {!l.isYou && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === l.userId}
                            onClick={() => toggle(l)}
                          >
                            {busy === l.userId ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : l.active ? (
                              <UserX className="size-4" aria-hidden="true" />
                            ) : (
                              <UserCheck className="size-4" aria-hidden="true" />
                            )}
                            {l.active ? "Switch off" : "Switch on"}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
