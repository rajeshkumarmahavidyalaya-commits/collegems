"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Loader2, UserPlus, X } from "lucide-react";
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
import { useI18n } from "@/components/providers/i18n-provider";
import { invite, revokeInvitation, type InvitationRow, type RoleOption } from "./actions";

/**
 * The three audiences, in the order somebody inviting thinks of them: most
 * invitations are staff, then families, and a second principal is rare.
 */
const TIER_ORDER = ["staff", "student", "principal"] as const;

const TIER_LABEL: Record<string, string> = {
  staff: "Staff — professors, librarians, the office",
  student: "Students and families",
  principal: "College administration",
};

/** Never colour alone — the word is always beside it. */
function statusTone(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "accepted") return "default";
  if (status === "pending") return "outline";
  return "secondary";
}

export function TeamView({
  invitations,
  roles,
  canManage,
}: {
  invitations: InvitationRow[];
  roles: RoleOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { formatDate } = useI18n();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(roles.find((r) => r.code === "teacher")?.id ?? roles[0]?.id ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    startTransition(async () => {
      const result = await invite({ email, roleId });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success(`Invitation sent to ${email}.`);
      setEmail("");
      router.refresh();
    });
  }

  function onRevoke(id: string, address: string) {
    startTransition(async () => {
      const result = await revokeInvitation(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`The invitation to ${address} was withdrawn.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite somebody</CardTitle>
            <CardDescription>
              They will be able to sign up with this address and no other. The role decides what they
              can see — you can change it later from the permission matrix.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onInvite} className="flex flex-col gap-4 sm:flex-row sm:items-end" noValidate>
              <div className="grid flex-1 gap-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teacher@school.example"
                  required
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? "invite-email-error" : undefined}
                />
                {fieldErrors.email && (
                  <p id="invite-email-error" className="text-sm text-destructive">
                    {fieldErrors.email[0]}
                  </p>
                )}
              </div>
              <div className="grid gap-2 sm:w-48">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/*
                    Grouped by tier, because "who is this login for?" is the
                    question being answered and six flat names do not ask it.
                    The grouping is presentation only -- what each role may do
                    is still the permission matrix, and it stays different
                    inside a group: a librarian cannot take fees.
                  */}
                  {TIER_ORDER.filter((tier) => roles.some((r) => r.tier === tier)).map((tier) => (
                    <optgroup key={tier} label={TIER_LABEL[tier]}>
                      {roles
                        .filter((r) => r.tier === tier)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UserPlus className="me-2 size-4" aria-hidden="true" />
                )}
                Invite
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invitations</CardTitle>
          <CardDescription>
            An invitation is how somebody joins this school. Until one exists for their address, a
            signup with it belongs to nobody.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitations.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="rounded-full bg-muted p-3">
                <Mail className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <p className="text-sm font-medium">Nobody has been invited yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                You are the only login this school has. Invite your office staff and teachers here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                    {canManage && <TableHead className="text-end">Action</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.email}</TableCell>
                      <TableCell className="text-muted-foreground">{inv.roleName}</TableCell>
                      <TableCell>
                        <Badge variant={statusTone(inv.status)}>{inv.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(inv.createdAt)}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-end">
                          {inv.status === "pending" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => onRevoke(inv.id, inv.email)}
                            >
                              <X className="me-1 size-4" aria-hidden="true" />
                              Withdraw
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
