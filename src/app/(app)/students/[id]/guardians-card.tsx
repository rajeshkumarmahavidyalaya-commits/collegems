"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Loader2, Link2, Pencil, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { unlinkGuardian } from "../guardian-actions";
import type { GuardianDraft } from "./guardian-dialogs";

/**
 * Both dialogs arrive on the click that opens them.
 *
 * A dialog needs no `loading:` state — it is fetched by the interaction that
 * shows it — and `ssr: false` keeps react-hook-form and the Zod resolver out of
 * the server render of a page most visitors only read.
 */
const GuardianFormDialog = dynamic(
  () => import("./guardian-dialogs").then((m) => m.GuardianFormDialog),
  { ssr: false },
);
const LinkGuardianDialog = dynamic(
  () => import("./guardian-dialogs").then((m) => m.LinkGuardianDialog),
  { ssr: false },
);

export type GuardianRow = {
  guardianId: string;
  fullName: string;
  relationship: string;
  /**
   * The relationship's name in the reader's language, resolved on the server.
   *
   * Not `relationshipLabel(relationship, t)` here: `useI18n()` would pull the
   * whole 57 kB catalogue onto a route whose only other client code is this
   * card. Measured: 167 kB before, 217 kB with the hook, 170 kB with the name
   * passed in — the `PhotoControl` bargain from the ID-card batch.
   */
  relationshipName: string;
  isPrimary: boolean;
  canPickup: boolean;
  phone: string | null;
  email: string | null;
  occupation: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{value ?? "—"}</dd>
    </div>
  );
}

function toDraft(g: GuardianRow): GuardianDraft {
  return {
    guardianId: g.guardianId,
    firstName: g.firstName,
    middleName: g.middleName ?? "",
    lastName: g.lastName ?? "",
    phone: g.phone ?? "",
    email: g.email ?? "",
    addressLine1: g.addressLine1 ?? "",
    city: g.city ?? "",
    state: g.state ?? "",
    occupation: g.occupation ?? "",
    relationship: g.relationship,
    isPrimary: g.isPrimary,
    canPickup: g.canPickup,
  };
}

/**
 * Who to contact about a student, and who may collect them.
 *
 * Read-only until migration `0221`, because there was no write path: the 555
 * links on the demo college came from the seed, and the bulk import collected a
 * guardian's name and number, refused a row that lacked the number, and then
 * dropped both.
 *
 * `canManage` is `guardians.manage`. Rule 4's UI note holds — hiding a button
 * protects nothing, and the policies on `people`, `guardians` and
 * `guardian_student` are administrator-only, so a teacher reaching the RPC
 * directly is refused by Postgres. What the flag decides is whether somebody is
 * walked through a form that will refuse them at the end of it.
 */
export function GuardiansCard({
  studentId,
  studentName,
  guardians,
  relationships,
  canManage,
}: {
  studentId: string;
  studentName: string;
  guardians: GuardianRow[];
  relationships: { value: string; label: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [draft, setDraft] = useState<GuardianDraft | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(g: GuardianRow) {
    // Destructive and, because the guardian row survives, reversible by linking
    // them again — which the confirmation says rather than leaving somebody to
    // wonder whether they have just deleted a person.
    const ok = window.confirm(
      `Remove ${g.fullName} as a guardian of ${studentName}?\n\n` +
        `${g.fullName} stays in the school's records — any other children of theirs keep them — ` +
        `and you can link them back at any time.`,
    );
    if (!ok) return;

    setRemoving(g.guardianId);
    startTransition(async () => {
      const result = await unlinkGuardian(studentId, g.guardianId);
      setRemoving(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${g.fullName} is no longer a guardian of ${studentName}.`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Guardians</CardTitle>
          <CardDescription>Who to contact, and who may collect this student</CardDescription>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(null);
                setFormOpen(true);
              }}
            >
              <UserPlus className="size-4" aria-hidden="true" />
              Add guardian
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLinkOpen(true)}>
              <Link2 className="size-4" aria-hidden="true" />
              Link an existing one
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {guardians.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm font-medium">No guardians yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canManage
                ? "Nobody is recorded as a contact for this student — no absence notice, fee reminder or result will reach a family."
                : "Nobody is recorded as a contact for this student. Ask the office to add one."}
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {guardians.map((g) => (
              <li key={g.guardianId} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-words">{g.fullName}</span>
                  <Badge variant="secondary">{g.relationshipName}</Badge>
                  {g.isPrimary && <Badge variant="outline">Primary contact</Badge>}
                  {!g.canPickup && <Badge variant="outline">May not collect</Badge>}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-3">
                  <Fact label="Phone" value={g.phone} />
                  <Fact label="Occupation" value={g.occupation} />
                </dl>
                {canManage && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDraft(toDraft(g));
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(g)}
                      disabled={pending && removing === g.guardianId}
                    >
                      {pending && removing === g.guardianId ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="size-4" aria-hidden="true" />
                      )}
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {canManage && formOpen && (
        <GuardianFormDialog
          studentId={studentId}
          studentName={studentName}
          draft={draft}
          relationships={relationships}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      )}
      {canManage && linkOpen && (
        <LinkGuardianDialog
          studentId={studentId}
          studentName={studentName}
          relationships={relationships}
          open={linkOpen}
          onOpenChange={setLinkOpen}
        />
      )}
    </Card>
  );
}
