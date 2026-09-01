"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { SelectField, TextField } from "@/components/forms/form-fields";
import { ErrorSummary } from "@/components/forms/error-summary";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes-guard";
import {
  GENDERS,
  STUDENT_STATUSES,
  studentSchema,
  type StudentInput,
} from "@/lib/validations/students";
import { admitStudent, updateStudent } from "./actions";

export function StudentForm({
  sections,
  student,
}: {
  sections: { id: string; label: string }[];
  student?: StudentInput & { id: string };
}) {
  const router = useRouter();
  const isEdit = !!student;

  const form = useForm<StudentInput>({
    resolver: zodResolver(studentSchema),
    defaultValues: student ?? {
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
    },
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

    toast.success(isEdit ? "Student updated" : "Student admitted");
    router.push(`/students/${result.data.id}`);
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
            <TextField control={form.control} name="lastName" label="Last name" required />
            <TextField control={form.control} name="middleName" label="Middle name" />
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
            <CardTitle>Admission &amp; enrolment</CardTitle>
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
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {isEdit ? "Save changes" : "Admit student"}
          </Button>
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
