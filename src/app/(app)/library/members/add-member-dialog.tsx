"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
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
import { StudentPicker, type PickedStudent } from "@/components/people/student-picker";
import {
  createMember,
  listStaffForLibrary,
  nextMembershipNumber,
  searchStudentsForLibrary,
} from "../actions";

/**
 * Give somebody a library card (0289). `createMember` had existed since the
 * library module and nothing called it, so a college could not add a
 * borrower -- and a new college's library could never lend a book.
 *
 * Loaded on the click that opens it, by `members-table.tsx`: the student
 * picker is not free, and most visits to the list never add anybody.
 */
export default function AddMemberDialog({
  onAdded,
  open,
  onOpenChange: setOpen,
}: {
  onAdded: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [kind, setKind] = useState<"student" | "staff">("student");
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const [staff, setStaff] = useState<{ id: string; label: string }[]>([]);
  const [staffId, setStaffId] = useState("");
  const [number, setNumber] = useState("");
  const [maxBooks, setMaxBooks] = useState("3");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    void nextMembershipNumber().then((n) => setNumber((cur) => cur || n));
    void listStaffForLibrary().then(setStaff);
  }, [open]);

  function reset() {
    setStudent(null);
    setStaffId("");
    setNumber("");
    setError(null);
  }

  function save() {
    setError(null);
    const holderId = kind === "student" ? student?.id : staffId;
    if (!holderId) {
      setError(kind === "student" ? "Choose a student." : "Choose a member of staff.");
      return;
    }
    startTransition(async () => {
      const result = await createMember({
        holderType: kind,
        holderId,
        membershipNumber: number.trim(),
        maxBooks: Number(maxBooks) || 1,
      });
      if (!result.ok) {
        setError(result.fieldErrors ? Object.values(result.fieldErrors).flat()[0] ?? result.error : result.error);
        return;
      }
      toast.success(`Card ${number.trim()} issued.`);
      setOpen(false);
      reset();
      onAdded();
    });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Give a library card</DialogTitle>
            <DialogDescription>A student or a member of staff can borrow once they have one.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="member-kind">Who</Label>
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v as "student" | "staff");
                  setMaxBooks(v === "staff" ? "5" : "3");
                }}
              >
                <SelectTrigger id="member-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">A student</SelectItem>
                  <SelectItem value="staff">A member of staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {kind === "student" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="member-student">Student</Label>
                <StudentPicker
                  id="member-student"
                  selected={student}
                  onSelect={setStudent}
                  search={searchStudentsForLibrary}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="member-staff">Member of staff</Label>
                <Select value={staffId} onValueChange={setStaffId}>
                  <SelectTrigger id="member-staff">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="member-number">Card number</Label>
                <Input id="member-number" value={number} onChange={(e) => setNumber(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="member-max">Books at once</Label>
                <Input
                  id="member-max"
                  inputMode="numeric"
                  value={maxBooks}
                  onChange={(e) => setMaxBooks(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !number.trim()}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Issue card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
