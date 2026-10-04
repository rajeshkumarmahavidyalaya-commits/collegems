"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assignSchoolAdmin, removeSchoolAdmin, type SchoolAdmin } from "../../actions";

/**
 * The reference's Admins for one school (0326). Adding an address answers in
 * one sentence whether or not it already has a login, because a form that
 * differed would tell any administrator which addresses are registered.
 */
export function AdminsManager({ tenantId, schoolName, admins }: { tenantId: string; schoolName: string; admins: SchoolAdmin[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const r = await assignSchoolAdmin(tenantId, email);
      if (!r.ok) return void toast.error(r.error);
      setMessage(r.data.message);
      toast.success("Administrator added", { description: r.data.message });
      setEmail("");
      router.refresh();
    });
  }

  function remove(a: SchoolAdmin) {
    if (!a.userId) return;
    if (!window.confirm(`Remove ${a.name || a.email} as an administrator of ${schoolName}?`)) return;
    start(async () => {
      const r = await removeSchoolAdmin(tenantId, a.userId as string);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${a.name || a.email} is no longer an administrator of ${schoolName}.`);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <div className="min-w-0 overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.map((a) => (
              <TableRow key={`${a.userId ?? "invite"}-${a.email}`}>
                <TableCell className="font-medium">
                  {a.name || "—"}
                  {a.isYou && <span className="ms-2 text-xs text-muted-foreground">(you)</span>}
                </TableCell>
                <TableCell className="break-all">{a.email}</TableCell>
                <TableCell>
                  <Badge variant={a.status === "active" ? "success" : "secondary"}>
                    {a.status === "active" ? "Active" : a.status === "invited" ? "Invited, not signed up" : "Switched off"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {a.userId && !a.isYou ? (
                    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => remove(a)}>
                      <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                      Remove
                    </Button>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <form onSubmit={add} className="flex h-fit flex-col gap-3 rounded-lg border bg-card p-4" noValidate>
        <h2 className="border-b pb-3 text-lg font-semibold">Add an administrator</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-email">Email address</Label>
          <Input id="admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="principal@college.edu" />
          <p className="text-xs text-muted-foreground">
            Somebody with a SchoolOS login becomes an administrator now; anybody else becomes one when they sign up
            with this address.
          </p>
        </div>
        <Button type="submit" disabled={pending || !email.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
          Add administrator
        </Button>
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </form>
    </div>
  );
}
