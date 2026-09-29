"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { createTest, type TeachingOption } from "./actions";

/**
 * Set a class test in one form: which class and subject, a title, a date and
 * what it is out of. Then straight to its mark sheet.
 */
export function NewTestDialog({ options, today }: { options: TeachingOption[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState(options[0] ? `${options[0].sectionId}|${options[0].subjectId}` : "");
  const [title, setTitle] = useState("");
  const [heldOn, setHeldOn] = useState(today);
  const [max, setMax] = useState("20");

  function submit() {
    const [sectionId, subjectId] = pick.split("|");
    startTransition(async () => {
      const result = await createTest({ sectionId, subjectId, title, heldOn, maxMarks: Number(max) });
      if (result.ok) {
        toast.success("Test set. Enter the marks.");
        setOpen(false);
        router.push(`/class-tests/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={options.length === 0}>
          <Plus className="size-4" aria-hidden="true" />
          Set a test
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set a class test</DialogTitle>
          <DialogDescription>
            A weekly test, a quiz, a unit test. The marks reach the family as soon as you enter them.
          </DialogDescription>
        </DialogHeader>
        <form
          id="new-test"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="test-class">Class and subject</Label>
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger id="test-class">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={`${o.sectionId}|${o.subjectId}`} value={`${o.sectionId}|${o.subjectId}`}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="test-title">Title</Label>
            <Input
              id="test-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Unit 3 test"
              maxLength={120}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-date">Held on</Label>
              <Input id="test-date" type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-max">Out of</Label>
              <Input
                id="test-max"
                type="number"
                inputMode="decimal"
                min={1}
                max={1000}
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="new-test" disabled={pending || !pick || title.trim() === ""}>
            Set the test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
