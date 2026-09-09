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
import { GENDERS } from "@/lib/validations/students";
import { staffSchema, type StaffInput } from "@/lib/validations/staff";
import { admitStaff, updateStaff } from "./actions";

/**
 * Adding or correcting a member of staff.
 *
 * **No status field, in either mode.** The students form has one because a
 * child's status is also how a re-admission is recorded; a member of staff
 * leaving ends nine relationships, so it is its own control on the record page
 * and goes through `staff_exit`. A dropdown here would be a second way to write
 * the same flag, and the one that does nothing else.
 */
export function StaffForm({ staff }: { staff?: StaffInput & { id: string } }) {
  const router = useRouter();
  const isEdit = !!staff;

  const form = useForm<StaffInput>({
    resolver: zodResolver(staffSchema),
    defaultValues: staff ?? {
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
      employeeCode: "",
      designation: "",
      department: "",
      dateOfJoining: new Date().toISOString().slice(0, 10),
    },
  });

  useUnsavedChangesGuard(form.formState.isDirty && !form.formState.isSubmitSuccessful);

  async function onSubmit(values: StaffInput) {
    const result = isEdit ? await updateStaff(staff.id, values) : await admitStaff(values);

    if (!result.ok) {
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof StaffInput, { message: messages[0] });
        }
      }
      toast.error(result.error);
      return;
    }

    toast.success(isEdit ? "Staff record updated" : "Added to the staff list");
    router.push(`/staff/${result.data.id}`);
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
              Biographical facts about the person, kept separately from their employment record —
              which is what lets a teacher also be a parent here without being two people.
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
            <CardTitle>Employment</CardTitle>
            <CardDescription>
              The designation is read by payroll and by the timetable, so it is required even when
              a department is not.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="employeeCode"
              label="Employee code"
              required
              description="Unique per school, and kept after they leave."
            />
            <TextField control={form.control} name="designation" label="Designation" required />
            <TextField control={form.control} name="department" label="Department" />
            <TextField
              control={form.control}
              name="dateOfJoining"
              label="Date of joining"
              type="date"
              required
            />
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {isEdit ? "Save changes" : "Add to staff"}
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
