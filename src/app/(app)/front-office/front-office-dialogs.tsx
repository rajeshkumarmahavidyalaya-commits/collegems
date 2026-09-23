"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";

import { Loader2, Phone, UserCheck } from "lucide-react";
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

import {
  SelectField,
  TextField,
  TextareaField,
} from "@/components/forms/form-fields";

import {
  convertSchema,
  ENQUIRY_SOURCES,
  enquirySchema,
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_OUTCOMES,
  followUpSchema,
  visitorSchema,
  type ConvertInput,
  type EnquiryInput,
  type FollowUpInput,
  type VisitorInput,
} from "@/lib/validations/front-office";
import {
  checkInVisitor,
  convertEnquiry,
  createEnquiry,
  logFollowUp,
  type EnquiryRow,
} from "./actions";

import type { Options } from "./front-office-view";

/*
 * Dialogs split out of the page so they load on the click that opens them:
 * this is where the page's Zod and form code lives, and a conditional render
 * is not a conditional load (see `fees-table.tsx`).
 */

export function EnquiryDialog({
  open,
  onOpenChange,
  classLevels,
  staff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classLevels: Options;
  staff: Options;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<EnquiryInput>({
    resolver: zodResolver(enquirySchema),
    values: {
      applicantFirstName: "",
      applicantLastName: "",
      dateOfBirth: "",
      gender: undefined,
      classLevelId: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      relationship: "",
      source: "walk_in",
      assignedStaffId: "",
      nextFollowUpOn: "",
      notes: "",
    },
  });

  function onSubmit(values: EnquiryInput) {
    startTransition(async () => {
      const result = await createEnquiry(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Enquiry ${result.data.number} logged.`);
      onOpenChange(false);
      form.reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New enquiry</DialogTitle>
          <DialogDescription>
            This does not create a student. It records a family that asked, so
            somebody can ring them back and the school can say what happened.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="applicantFirstName"
                label="Child's first name"
                required
              />
              <TextField
                control={form.control}
                name="applicantLastName"
                label="Last name"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="classLevelId"
                label="Class sought"
                options={[
                  { value: "", label: "Not settled yet" },
                  ...classLevels.map((c) => ({ value: c.id, label: c.label })),
                ]}
              />
              <TextField
                control={form.control}
                name="dateOfBirth"
                label="Date of birth"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="contactName"
                label="Contact name"
                required
              />
              <TextField
                control={form.control}
                name="relationship"
                label="Relationship"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="contactPhone"
                label="Phone"
                description="A phone number or an email is required."
              />
              <TextField
                control={form.control}
                name="contactEmail"
                label="Email"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="source"
                label="How they reached us"
                options={ENQUIRY_SOURCES.map((s) => ({
                  value: s.value,
                  label: s.label,
                }))}
              />
              <TextField
                control={form.control}
                name="nextFollowUpOn"
                label="Follow up on"
              />
            </div>

            <SelectField
              control={form.control}
              name="assignedStaffId"
              label="Assigned to"
              options={[
                { value: "", label: "Nobody yet" },
                ...staff.map((s) => ({ value: s.id, label: s.label })),
              ]}
            />

            <TextareaField
              control={form.control}
              name="notes"
              label="Notes"
              rows={2}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="cursor-pointer"
              >
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Log enquiry
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function FollowUpDialog({
  enquiry,
  onClose,
}: {
  enquiry: EnquiryRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<FollowUpInput>({
    resolver: zodResolver(followUpSchema),
    values: {
      enquiryId: enquiry?.id ?? "",
      note: "",
      channel: "phone",
      outcome: undefined,
      nextFollowUpOn: "",
      lostReason: "",
    },
  });

  const outcome = form.watch("outcome");

  function onSubmit(values: FollowUpInput) {
    startTransition(async () => {
      const result = await logFollowUp(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Contact logged.");
      onClose();
      form.reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={enquiry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log a contact</DialogTitle>
          <DialogDescription>
            {enquiry?.applicantName} · {enquiry?.contactName}. The log cannot be
            edited afterwards — a call record that can be tidied is not a record
            of what happened.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <SelectField
              control={form.control}
              name="channel"
              label="How"
              options={FOLLOW_UP_CHANNELS.map((c) => ({
                value: c.value,
                label: c.label,
              }))}
            />
            <TextareaField
              control={form.control}
              name="note"
              label="What was discussed"
              rows={3}
              required
            />
            <SelectField
              control={form.control}
              name="outcome"
              label="Move to"
              options={[
                { value: "", label: "Leave the stage unchanged" },
                ...FOLLOW_UP_OUTCOMES.map((o) => ({
                  value: o.value,
                  label: o.label,
                })),
              ]}
              description="Admitting is done by admitting the child, not by logging a note."
            />

            {outcome === "lost" ? (
              <TextField
                control={form.control}
                name="lostReason"
                label="Why they went elsewhere"
                required
              />
            ) : (
              <TextField
                control={form.control}
                name="nextFollowUpOn"
                label="Next follow-up"
              />
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="cursor-pointer"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Phone className="size-4" aria-hidden="true" />
                )}
                Log it
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function ConvertDialog({
  enquiry,
  onClose,
  sections,
}: {
  enquiry: EnquiryRow | null;
  onClose: () => void;
  sections: Options;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<ConvertInput>({
    resolver: zodResolver(convertSchema),
    values: {
      enquiryId: enquiry?.id ?? "",
      admissionNumber: "",
      sectionId: "",
      rollNumber: "",
      admissionDate: "",
    },
  });

  function onSubmit(values: ConvertInput) {
    startTransition(async () => {
      const result = await convertEnquiry(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Admitted as ${result.data.admissionNumber}.`);
      onClose();
      form.reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={enquiry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Admit {enquiry?.applicantName}</DialogTitle>
          <DialogDescription>
            This creates the person, the student and the enrolment through the
            school&apos;s one admission path, and closes the enquiry against it.
            It cannot be done twice.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <TextField
              control={form.control}
              name="admissionNumber"
              label="Admission number"
              required
            />
            <SelectField
              control={form.control}
              name="sectionId"
              label="Section"
              options={[
                { value: "", label: "Not placed yet" },
                ...sections.map((s) => ({ value: s.id, label: s.label })),
              ]}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="rollNumber"
                label="Roll number"
              />
              <TextField
                control={form.control}
                name="admissionDate"
                label="Admission date"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="cursor-pointer"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UserCheck className="size-4" aria-hidden="true" />
                )}
                Admit
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function VisitorDialog({
  open,
  onOpenChange,
  staff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: Options;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<VisitorInput>({
    resolver: zodResolver(visitorSchema),
    values: {
      visitorName: "",
      purpose: "",
      phone: "",
      organisation: "",
      hostStaffId: "",
      hostNote: "",
      studentId: "",
      idProofKind: "",
      idProofLast4: "",
      vehicleNumber: "",
    },
  });

  function onSubmit(values: VisitorInput) {
    startTransition(async () => {
      const result = await checkInVisitor(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Pass ${result.data.pass} issued.`);
      onOpenChange(false);
      form.reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sign somebody in</DialogTitle>
          <DialogDescription>
            Record the last four characters of an identity document, never the
            whole number and never a scan — a photocopy of somebody&apos;s ID at
            a school gate is a liability.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="visitorName"
                label="Name"
                required
              />
              <TextField control={form.control} name="phone" label="Phone" />
            </div>
            <TextField
              control={form.control}
              name="purpose"
              label="Purpose"
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="organisation"
                label="Organisation"
              />
              <SelectField
                control={form.control}
                name="hostStaffId"
                label="Here to see"
                options={[
                  { value: "", label: "Not recorded" },
                  ...staff.map((s) => ({ value: s.id, label: s.label })),
                ]}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                control={form.control}
                name="idProofKind"
                label="ID type"
              />
              <TextField
                control={form.control}
                name="idProofLast4"
                label="Last 4"
              />
              <TextField
                control={form.control}
                name="vehicleNumber"
                label="Vehicle"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="cursor-pointer"
              >
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Issue pass
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
