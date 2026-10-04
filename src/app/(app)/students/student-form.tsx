"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { lazyZodResolver } from "@/lib/forms/lazy-resolver";
import { toast } from "sonner";
import { Loader2, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form } from "@/components/ui/form";
import { SelectField, TextField } from "@/components/forms/form-fields";
import { ErrorSummary } from "@/components/forms/error-summary";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes-guard";
import { GENDERS, STUDENT_STATUSES } from "@/lib/validations/students-display";
import { missingRequired } from "@/lib/validations/admission-required";
import type { StudentInput } from "@/lib/validations/students";
import { admitStudent, updateStudent, type AdmissionOptions } from "./actions";
import { saveStudentType } from "../fees/setup/student-type-actions";

export function StudentForm({
  options,
  required = [],
  canAddType = false,
  student,
  busStops = [],
  hostelRooms = [],
}: {
  /** Classes with this year's sections, kinds of student, mediums, houses (0328). */
  options: AdmissionOptions;
  /** Fields this college requires at admission (0330); the action re-checks. */
  required?: string[];
  /** An administrator or accountant may add a kind of student from the form. */
  canAddType?: boolean;
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
      classLevelId: "",
      sectionId: "",
      rollNumber: "",
      // Regular is listed first, and is the answer for most children.
      studentTypeId: options.types[0]?.id ?? "",
      mediumId: "",
      houseId: "",
      busStopId: "",
      hostelRoomId: "",
  };

  const form = useForm<StudentInput>({
    // Admission requires a class and a kind of student; an edit does not,
    // because an alumnus has no class this year (0328).
    resolver: lazyZodResolver<StudentInput>(() =>
      import("@/lib/validations/students").then((m) => (isEdit ? m.studentSchema : m.admissionSchema)),
    ),
    defaultValues: student ?? blank,
  });

  const [types, setTypes] = useState(options.types);
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState("");
  const [typePending, startType] = useTransition();
  const classLevelId = form.watch("classLevelId");
  const chosenClass = options.classes.find((c) => c.id === classLevelId) ?? null;

  function addType() {
    const name = newType.trim();
    if (name.length < 2) return void toast.error("Give the kind of student a name of at least 2 characters.");
    startType(async () => {
      const r = await saveStudentType({ name });
      if (!r.ok) return void toast.error(r.error);
      setTypes((list) => [...list, { id: r.data.id, name }]);
      form.setValue("studentTypeId", r.data.id, { shouldDirty: true, shouldValidate: true });
      setNewType("");
      setAddingType(false);
      toast.success(`"${name}" added to the kinds of student.`);
    });
  }

  useUnsavedChangesGuard(form.formState.isDirty && !form.formState.isSubmitSuccessful);

  // Only at admission: an edit of a record admitted before the rule existed
  // must still save.
  const need = (field: string) => !isEdit && required.includes(field);

  async function onSubmit(values: StudentInput) {
    if (!isEdit) {
      const missing = missingRequired(values, required);
      const fields = Object.keys(missing);
      if (fields.length) {
        for (const [field, messages] of Object.entries(missing)) {
          form.setError(field as keyof StudentInput, { message: messages[0] });
        }
        form.setFocus(fields[0] as keyof StudentInput);
        toast.error("Fill in the fields your college requires at admission.");
        return;
      }
    }
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
        classLevelId: values.classLevelId,
        sectionId: values.sectionId,
        studentTypeId: values.studentTypeId,
        mediumId: values.mediumId,
        houseId: values.houseId,
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
            <CardTitle>Personal Detail</CardTitle>
            <CardDescription>
              Biographical facts about the person, kept separately from their student record.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <TextField control={form.control} name="firstName" label="First name" required />
            <TextField control={form.control} name="middleName" label="Middle name" />
            <TextField control={form.control} name="lastName" label="Last name" required />
            <TextField control={form.control} name="dateOfBirth" label="Date of birth" required={need("dateOfBirth")} type="date" />
            <SelectField
              control={form.control}
              name="gender"
              label="Gender"
              required={need("gender")}
              placeholder="Not recorded"
              options={GENDERS.map((g) => ({ value: g.value, label: g.label }))}
            />
            <TextField control={form.control} name="bloodGroup" label="Blood group" required={need("bloodGroup")} />
            <TextField control={form.control} name="email" label="Email" required={need("email")} type="email" />
            <TextField control={form.control} name="phone" label="Phone" required={need("phone")} />
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
              required={need("addressLine1")}
              className="sm:col-span-2"
            />
            <TextField
              control={form.control}
              name="addressLine2"
              label="Address line 2"
              className="sm:col-span-2"
            />
            <TextField control={form.control} name="city" label="City" required={need("city")} />
            <TextField control={form.control} name="state" label="State" required={need("state")} />
            <TextField control={form.control} name="postalCode" label="Postal code" required={need("postalCode")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Admission Detail</CardTitle>
            <CardDescription>
              {isEdit
                ? "The class and section this year, and the kind of student."
                : "Every student joins a class and a section for the current session, and is given a kind of student."}
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
              name="classLevelId"
              label="Class"
              required={!isEdit}
              placeholder={options.classes.length ? "Select class" : "No classes yet"}
              options={options.classes.map((c) => ({
                value: c.id,
                label: c.sections.length ? c.name : `${c.name} (no section yet)`,
              }))}
              // A section belongs to its class: choosing another class
              // clears it, and a class with one section chooses it.
              onValueChange={(id) => {
                const cls = options.classes.find((c) => c.id === id);
                form.setValue("sectionId", cls?.sections.length === 1 ? cls.sections[0].id : "", {
                  shouldDirty: true,
                });
              }}
            />
            <SelectField
              key={classLevelId || "none"}
              control={form.control}
              name="sectionId"
              label="Section"
              required={!isEdit}
              placeholder={chosenClass ? (chosenClass.sections.length ? "Select section" : "No section") : "Choose a class first"}
              options={(chosenClass?.sections ?? []).map((sec) => ({ value: sec.id, label: sec.name }))}
            />
            {options.classes.length === 0 && (
              <p role="alert" className="flex items-start gap-2 text-sm text-destructive sm:col-span-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  There are no classes yet. Add one under{" "}
                  <Link href="/academics" className="underline">Manage Classes</Link> first.
                </span>
              </p>
            )}
            {chosenClass && chosenClass.sections.length === 0 && (
              <p role="alert" className="flex items-start gap-2 text-sm text-destructive sm:col-span-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {chosenClass.name} has no section this year, so nobody can join it yet. Add a section
                  (such as A) under <Link href="/academics" className="underline">Manage Classes</Link>.
                </span>
              </p>
            )}
            <TextField control={form.control} name="rollNumber" label="Roll number" required={need("rollNumber")} />
            <div className="flex flex-col gap-2">
              <SelectField
                control={form.control}
                name="studentTypeId"
                label="Student type"
                required={!isEdit}
                placeholder={types.length ? "Select kind of student" : "No kinds yet"}
                options={types.map((t) => ({ value: t.id, label: t.name }))}
                description="Regular, Carry Forward, Private Candidate… A kind can have its own fees."
              />
              {canAddType &&
                (addingType ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Label htmlFor="new-student-type">New kind of student</Label>
                      <Input
                        id="new-student-type"
                        value={newType}
                        onChange={(e) => setNewType(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addType();
                          }
                        }}
                        maxLength={60}
                        placeholder="e.g. NRI Quota"
                      />
                    </div>
                    <Button type="button" size="sm" onClick={addType} disabled={typePending}>
                      {typePending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                      Add
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setAddingType(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="self-start"
                    onClick={() => setAddingType(true)}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Add a new student type
                  </Button>
                ))}
            </div>
            <SelectField
              control={form.control}
              name="mediumId"
              label="Medium"
              required={need("mediumId")}
              placeholder={options.mediums.length ? "Select medium" : "No mediums yet"}
              options={options.mediums.map((m) => ({ value: m.id, label: m.name }))}
              description={options.mediums.length ? undefined : "Add them under SM Academic › Manage Medium."}
            />
            <SelectField
              control={form.control}
              name="houseId"
              label="House"
              required={need("houseId")}
              placeholder={options.houses.length ? "Select house" : "No houses yet"}
              options={options.houses.map((h) => ({ value: h.id, label: h.name }))}
              description={options.houses.length ? undefined : "Add them under SM Academic › Manage House."}
            />
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

        <div className="flex flex-wrap items-center gap-3">
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
