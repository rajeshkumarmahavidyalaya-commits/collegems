"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { invite } from "../../settings/team/actions";

/**
 * Give a member of staff a login from their own record (0289). Before this the
 * office added a teacher here, went to Settings > Team, chose the role and
 * searched for the same person again. The same `invite` action does the work,
 * so the two screens cannot disagree about what an invitation is; the staff
 * record is the subject, which is the one thing the picker existed to find.
 */
export function GiveLoginControl({
  staffId,
  name,
  email,
  roles,
}: {
  staffId: string;
  name: string;
  email: string | null;
  roles: { id: string; name: string; code: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(email ?? "");
  const [roleId, setRoleId] = useState(roles.find((r) => r.code === "teacher")?.id ?? roles[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await invite({ email: address.trim(), roleId, subjectId: staffId });
      if (!result.ok) {
        setError(result.fieldErrors?.email?.[0] ?? result.error);
        return;
      }
      setOpen(false);
      const emailed = result.data.announced.length > 0;
      toast.success(`${name} is invited.`, {
        description: emailed
          ? `The invitation was sent to ${address.trim()}.`
          : "It was recorded, but not sent -- tell them to sign up with this address.",
      });
      router.refresh();
    });
  }

  if (roles.length === 0) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <KeyRound className="size-4" aria-hidden="true" />
        Give a login
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Give {name} a login</DialogTitle>
            <DialogDescription>
              They are sent an invitation and sign up with this address. What they can see comes
              from the role.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="give-login-email">Email address</Label>
              <Input
                id="give-login-email"
                type="email"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="give-login-role">Role</Label>
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger id="give-login-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={send} disabled={pending || !address.trim() || !roleId}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
