"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import { createTestSchema, type CreateTestInput } from "@/lib/validations/online-tests";
import { createTest, type Course } from "./actions";

/**
 * Setting a test. Offered only to `onlinetests.manage`, over `teaching_courses()`
 * -- the write policies' own predicate -- so the dialog cannot offer a class the
 * insert would refuse.
 */
export function NewTestButton({ courses }: { courses: Course[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<CreateTestInput>({
    resolver: zodResolver(createTestSchema),
    defaultValues: {
      course: courses[0]?.value ?? "",
      title: "",
      instructions: "",
      opensOn: "",
      opensAt: "09:00",
      closesOn: "",
      closesAt: "17:00",
      minutes: "30",
      reveal: "after_close",
    },
  });

  function submit(values: CreateTestInput) {
    startTransition(async () => {
      const result = await createTest(values);
      if (!result.ok) {
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as keyof CreateTestInput, { message: messages[0] });
        }
        toast.error(result.error);
        return;
      }
      toast.success("Test created as a draft. Add its questions, then publish it.");
      setOpen(false);
      router.push(`/online-tests/${result.data.id}`);
    });
  }

  if (courses.length === 0) {
    // A sentence rather than a button that will refuse you (rule 6, `purchasable`).
    return (
      <p className="max-w-md text-sm text-muted-foreground">
        There is no class to set a test for: no subject is assigned to you in a year that has not
        ended yet.{" "}
        <Link href="/academics" className="underline underline-offset-2">
          Assign subjects in Academics
        </Link>
        .
      </p>
    );
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        New test
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Set an online test</DialogTitle>
            <DialogDescription>
              It starts as a draft only you can see. Times are the college&apos;s own. Each student
              gets the minutes below from the moment they begin, and never past the close.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
              <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
              <SelectField
                control={form.control}
                name="course"
                label="Class and subject"
                required
                options={courses.map((c) => ({ value: c.value, label: `${c.label} (${c.sessionName})` }))}
              />
              <TextField control={form.control} name="title" label="Title" required />
              <TextareaField control={form.control} name="instructions" label="Instructions" rows={2} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField control={form.control} name="opensOn" label="Opens on" type="date" required />
                <TextField control={form.control} name="opensAt" label="Opening time" type="time" required />
                <TextField control={form.control} name="closesOn" label="Closes on" type="date" required />
                <TextField control={form.control} name="closesAt" label="Closing time" type="time" required />
              </div>
              <TextField control={form.control} name="minutes" label="Minutes each student has" type="number" required />
              <SelectField
                control={form.control}
                name="reveal"
                label="Show students the answers"
                options={[
                  { value: "after_close", label: "After the test closes for everybody" },
                  { value: "never", label: "Never — only their mark" },
                ]}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  Create draft
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
