"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { lazyZodResolver } from "@/lib/forms/lazy-resolver";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { SelectField, TextField } from "@/components/forms/form-fields";
import { ErrorSummary } from "@/components/forms/error-summary";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes-guard";
import { GENDERS, STUDENT_STATUSES } from "@/lib/validations/students-display";
import type { StudentInput } from "@/lib/validations/students";
import { admitStudent, updateStudent } from "./actions";

export function StudentForm({
  sections,
  student,
  busStops = [],
  hostelRooms = [],
}: {
  sections: { id: string; label: string }[];
  student?: StudentInput & { id: string };
  /** Offered at admission only, and only to somebody who may assign (0296). */
  busStops?: { id: string; label: string; full?: boolean }[];
  hostelRooms?: { id: string; label: string; full?: boolean }[];
}) {
  const router = useRouter();
  const isEdit = !!student;

  // "Save and add another" (0290): an office admitting a class of new
  // children does it one after another, and each trip through the new record
  // and back is two page loads for nothing.
  const another = useRef(false);
  const blank: StudentInput = {
      firstName: "",
      middleName: "",
      lastName: "",
      dateOfBirth: "",
      gender: undefined,
      bloodGroup: "",
      email: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
      admissionNumber: "",
      admissionDate: new Date().toISOString().slice(0, 10),
      status: "active",
      sectionId: "",
      rollNumber: "",
      busStopId: "",
      hostelRoomId: "",
  };

  const form = useForm<StudentInput>({
    resolver: lazyZodResolver<StudentInput>(() => import("@/lib/validations/students").then((m) => m.studentSchema)),
    defaultValues: student ?? blank,
  });

  useUnsavedChangesGuard(form.formState.isDirty && !form.formState.isSubmitSuccessful);

  async function onSubmit(values: StudentInput) {
    const result = isEdit ? await updateStudent(student.id, values) : await admitStudent(values);

    if (!result.ok) {
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof StudentInput, { message: messages[0] });
        }
      }
      toast.error(result.error);
      return;
    }

    // Two facts on admission, each on its own line: the child is admitted, and
    // whether the admission fee was billed. Saying only the first is how an
    // office comes to believe a bill went out (0286).
    const billing =
      !isEdit && "billing" in result.data
        ? (result.data.billing as { billed: boolean; message: string } | null)
        : null;
    // The bus seat and the bed are two more facts, said the same way: each
    // one that was refused is named, and none of them un-admits the child.
    const arrangements =
      !isEdit && "arrangements" in result.data
        ? (result.data.arrangements as { ok: boolean; message: string }[])
        : [];
    const refused = arrangements.some((a) => !a.ok);
    const description =
      [billing?.message, ...arrangements.map((a) => a.message)].filter(Boolean).join(" ") || undefined;
    const id = result.data.id;
    const staying = !isEdit && another.current;
    // Staying on the form, the toast is the only way back to the child just
    // admitted, so it carries the link.
    const open = staying ? { label: "Open", onClick: () => router.push(`/students/${id}`) } : undefined;
    const admitted = staying ? `${values.firstName} ${values.lastName} admitted` : "Student admitted";
    if ((billing && !billing.billed) || refused) {
      toast.warning(admitted, { description, action: open });
    } else {
      toast.success(isEdit ? "Student updated" : admitted, { description, action: open });
    }
    if (staying) {
      // Keep the class and the date: the next child is usually going into the
      // same section on the same day.
      form.reset({
        ...blank,
        sectionId: values.sectionId,
        admissionDate: values.admissionDate,
        busStopId: values.busStopId,
        hostelRoomId: values.hostelRoomId,
      });
      form.setFocus("firstName");
      router.refresh();
      return;
    }
    // A new admission ends on the admitted screen (0300's round): the letter,
    // the first fee, the family's login and the bus, in one place. An edit
    // goes back to the record it came from.
    router.push(isEdit ? `/students/${result.data.id}` : `/students/${result.data.id}/admitted`);
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
        <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

        <Card>
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
            <CardDescription>
              Biographical facts about the person, kept separately from their student record.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <TextField control={form.control} name="firstName" label="First name" required />
            <TextField control={form.control} name="middleName" label="Middle name" />
            <TextField control={form.control} name="lastName" label="Last name" required />
            <TextField control={form.control} name="dateOfBirth" label="Date of birth" type="date" />
            <SelectField
              control={form.control}
              name="gender"
              label="Gender"
              placeholder="Not recorded"
              options={GENDERS.map((g) => ({ value: g.value, label: g.label }))}
            />
            <TextField control={form.control} name="bloodGroup" label="Blood group" />
            <TextField control={form.control} name="email" label="Email" type="email" />
            <TextField control={form.control} name="phone" label="Phone" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="addressLine1"
              label="Address line 1"
              className="sm:col-span-2"
            />
            <TextField
              control={form.control}
              name="addressLine2"
              label="Address line 2"
              className="sm:col-span-2"
            />
            <TextField control={form.control} name="city" label="City" />
            <TextField control={form.control} name="state" label="State" />
            <TextField control={form.control} name="postalCode" label="Postal code" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Admission details</CardTitle>
            <CardDescription>
              Enrolment places the student in a section for the current session. It can be left
              blank now and set later.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="admissionNumber"
              label="Admission number"
              required
              description="Unique per school, and kept across re-admission."
            />
            <TextField
              control={form.control}
              name="admissionDate"
              label="Admission date"
              type="date"
              required
            />
            <SelectField
              control={form.control}
              name="sectionId"
              label="Class · section"
              placeholder="Not enrolled yet"
              options={sections.map((s) => ({ value: s.id, label: s.label }))}
            />
            <TextField control={form.control} name="rollNumber" label="Roll number" />
            {!isEdit && busStops.length > 0 && (
              <SelectField
                control={form.control}
                name="busStopId"
                label="School bus"
                placeholder="Does not take the bus"
                options={[
                  { value: "", label: "Does not take the bus" },
                  ...busStops.map((s) => ({ value: s.id, label: s.full ? `${s.label} (full)` : s.label })),
                ]}
                description="The stop's fare joins the next invoice."
              />
            )}
            {!isEdit && hostelRooms.length > 0 && (
              <SelectField
                control={form.control}
                name="hostelRoomId"
                label="Hostel"
                placeholder="Day scholar"
                options={[
                  { value: "", label: "Day scholar" },
                  ...hostelRooms.map((r) => ({ value: r.id, label: r.full ? `${r.label} (full)` : r.label })),
                ]}
              />
            )}
            {isEdit && (
              <SelectField
                control={form.control}
                name="status"
                label="Status"
                options={STUDENT_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
                description="Students are never deleted — status is how a leaver is recorded."
              />
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={form.formState.isSubmitting}
            onClick={() => {
              another.current = false;
            }}
          >
            {form.formState.isSubmitting && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {isEdit ? "Save changes" : "Admit student"}
          </Button>
          {!isEdit && (
            <Button
              type="submit"
              variant="outline"
              disabled={form.formState.isSubmitting}
              onClick={() => {
                another.current = true;
              }}
            >
              Admit and add another
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (!form.formState.isDirty || window.confirm("Discard your unsaved changes?")) {
                router.back();
              }
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}
