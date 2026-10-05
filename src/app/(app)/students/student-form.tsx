"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
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
import { SelectField, TextareaField, TextField } from "@/components/forms/form-fields";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/components/providers/i18n-provider";
import { ErrorSummary } from "@/components/forms/error-summary";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes-guard";
import { GENDERS, STUDENT_STATUSES } from "@/lib/validations/students-display";
import { HEARD_FROM, missingRequired } from "@/lib/validations/admission-required";
import { GUARDIAN_RELATIONSHIPS } from "@/lib/validations/guardians-display";
import type { StudentFormValues as StudentInput } from "@/lib/validations/students";
import {
  admitStudent,
  classFees,
  nextAdmissionNumber,
  updateStudent,
  type AdmissionOptions,
  type AdmissionSettings,
  type ClassFee,
} from "./actions";
import { saveStudentType } from "../fees/setup/student-type-actions";

export function StudentForm({
  options,
  settings,
  canAddType = false,
  profileEditable = false,
  student,
  busStops = [],
  hostelRooms = [],
  arrangementHints = [],
}: {
  /** Classes with this year's sections, kinds of student, mediums, houses (0328). */
  options: AdmissionOptions;
  /**
   * At admission: what the college's Registration Settings decide (0330,
   * 0331) -- required fields, optional panels and numbering. The action
   * re-checks every one of them.
   */
  settings?: AdmissionSettings;
  /** Religion, caste, ID and medical details: the administrator's (0331). */
  profileEditable?: boolean;
  /** An administrator or accountant may add a kind of student from the form. */
  canAddType?: boolean;
  student?: StudentInput & { id: string };
  /** Offered at admission only, and only to somebody who may assign (0296). */
  busStops?: { id: string; label: string; full?: boolean }[];
  hostelRooms?: { id: string; label: string; full?: boolean }[];
  /** Why a bus or hostel field is absent when the module exists (no stops, no rooms). */
  arrangementHints?: string[];
}) {
  const router = useRouter();
  const { formatCurrency } = useI18n();
  const isEdit = !!student;
  const required = settings?.required ?? [];
  const panels = settings?.panels;
  const autoRoll = settings?.numbering.autoRollNumber === true;
  const showProfile = profileEditable;
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoKey, setPhotoKey] = useState(0);
  const [fees, setFees] = useState<ClassFee[] | null>(null);

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
      country: "India",
      religion: "",
      caste: "",
      idNumber: "",
      medicalNotes: "",
      heardFrom: "",
      parentFirstName: "",
      parentLastName: "",
      parentRelationship: "father",
      parentPhone: "",
      parentEmail: "",
      parentOccupation: "",
      inviteParent: false,
      inviteStudent: false,
      admissionNumber: settings?.nextAdmissionNumber ?? "",
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

  // The Fees panel (0331): what the chosen class pays, read when it changes.
  const showFees = !isEdit && panels?.fees === true;
  useEffect(() => {
    if (!showFees || !classLevelId) {
      setFees(null);
      return;
    }
    let live = true;
    classFees(classLevelId).then((rows) => live && setFees(rows));
    return () => {
      live = false;
    };
  }, [showFees, classLevelId]);

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
      // A blank roll number is filled in by the server when the college asked
      // for that, so it is not missing here.
      const asked = autoRoll ? required.filter((f) => f !== "rollNumber") : required;
      const missing = missingRequired({ ...values, photo: photo !== null }, asked);
      const fields = Object.keys(missing);
      if (fields.length) {
        for (const [field, messages] of Object.entries(missing)) {
          if (field === "photo") continue;
          form.setError(field as keyof StudentInput, { message: messages[0] });
        }
        if (missing.photo) document.getElementById("student-photo")?.focus();
        else form.setFocus(fields[0] as keyof StudentInput);
        toast.error(missing.photo && fields.length === 1 ? "Choose the student's photograph." : "Fill in the fields your college requires at admission.");
        return;
      }
    }
    let photoData: FormData | null = null;
    if (!isEdit && photo) {
      photoData = new FormData();
      photoData.set("photo", photo);
    }
    const result = isEdit ? await updateStudent(student.id, values) : await admitStudent(values, photoData);

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
      const nextNumber = settings?.numbering.autoAdmissionNumber ? await nextAdmissionNumber() : null;
      setPhoto(null);
      setPhotoKey((k) => k + 1);
      form.reset({
        ...blank,
        admissionNumber: nextNumber ?? "",
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
            <TextField control={form.control} name="lastName" label="Last name" required={isEdit ? false : need("lastName")} />
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
            {showProfile && (
              <>
                <TextField control={form.control} name="religion" label="Religion" required={need("religion")} />
                <TextField control={form.control} name="caste" label="Caste/Sub-caste" required={need("caste")} />
                <TextField
                  control={form.control}
                  name="idNumber"
                  label="ID number/proof"
                  required={need("idNumber")}
                  description="Aadhaar or another ID. Seen only by the administrator and the family."
                />
                <TextareaField
                  control={form.control}
                  name="medicalNotes"
                  label="Medical complaint"
                  required={need("medicalNotes")}
                  className="sm:col-span-2"
                />
              </>
            )}
            {!isEdit && (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="student-photo">
                  Student photo
                  {need("photo") && <span aria-hidden="true" className="text-destructive"> *</span>}
                </Label>
                <Input
                  key={photoKey}
                  id="student-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                />
                <p className="text-sm text-muted-foreground">JPEG, PNG or WebP. Saved with the record once the student is admitted.</p>
              </div>
            )}
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
            {!isEdit && <TextField control={form.control} name="country" label="Country" required={need("country")} />}
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
              description={
                settings?.numbering.autoAdmissionNumber
                  ? "The next number is filled in; change it if you need to. Unique per school."
                  : "Unique per school, and kept across re-admission."
              }
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
                const only = cls?.sections.length === 1 ? cls.sections[0].id : "";
                // Validated when it chose for the person, so a "choose the
                // section" error from an earlier submit does not outlive it.
                form.setValue("sectionId", only, { shouldDirty: true, shouldValidate: Boolean(only) });
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
            <TextField
              control={form.control}
              name="rollNumber"
              label="Roll number"
              required={need("rollNumber") && !autoRoll}
              placeholder={!isEdit && autoRoll ? "Next in the section if left blank" : undefined}
            />
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
            {!isEdit && panels?.transport !== false && busStops.length > 0 && (
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
            {!isEdit && panels?.transport !== false && hostelRooms.length > 0 && (
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
            {!isEdit && panels?.transport !== false &&
              arrangementHints.map((hint) => (
                <p key={hint} className="flex items-start gap-2 text-sm text-muted-foreground sm:col-span-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                  {hint}
                </p>
              ))}
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

        {showFees && (
          <Card>
            <CardHeader>
              <CardTitle>Fees</CardTitle>
              <CardDescription>What the chosen class pays this year, from Fee Types.</CardDescription>
            </CardHeader>
            <CardContent>
              {!classLevelId ? (
                <p className="text-sm text-muted-foreground">Choose a class to see its fees.</p>
              ) : fees === null ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : fees.length === 0 ? (
                <p className="text-sm text-muted-foreground">No fee is set for this class this year.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {fees.map((f, i) => (
                    <li key={i} className="flex justify-between gap-3 border-b py-1.5">
                      <span>
                        {f.head}
                        {f.forType && <span className="text-muted-foreground"> · {f.forType} only</span>}
                      </span>
                      <span className="tabular-nums">{formatCurrency(f.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {!isEdit && panels?.parent_details && (
          <Card>
            <CardHeader>
              <CardTitle>Parent Detail</CardTitle>
              <CardDescription>Made with the student as their primary contact. Leave blank to add a parent later.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <TextField control={form.control} name="parentFirstName" label="Parent first name" />
              <TextField control={form.control} name="parentLastName" label="Parent last name" />
              <SelectField
                control={form.control}
                name="parentRelationship"
                label="Relationship"
                options={GUARDIAN_RELATIONSHIPS.map((r) => ({ value: r.value, label: r.label }))}
              />
              <TextField control={form.control} name="parentOccupation" label="Occupation" />
              <TextField control={form.control} name="parentPhone" label="Parent phone" />
              <TextField control={form.control} name="parentEmail" label="Parent email" type="email" />
            </CardContent>
          </Card>
        )}

        {!isEdit && (panels?.parent_login || panels?.student_login) && (
          <Card>
            <CardHeader>
              <CardTitle>Login</CardTitle>
              <CardDescription>
                An invitation is emailed; the login exists once they sign up with that address.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {panels?.parent_login && (
                <label className="flex items-start gap-2">
                  <Checkbox
                    checked={form.watch("inviteParent") === true}
                    onCheckedChange={(v) => form.setValue("inviteParent", v === true, { shouldDirty: true })}
                    className="mt-0.5"
                  />
                  <span>
                    Invite the parent to sign in
                    <span className="block text-sm text-muted-foreground">
                      {panels.parent_details ? "To the parent email above." : "Needs the Parent Details panel, switched on in Registration Settings."}
                    </span>
                  </span>
                </label>
              )}
              {panels?.student_login && (
                <label className="flex items-start gap-2">
                  <Checkbox
                    checked={form.watch("inviteStudent") === true}
                    onCheckedChange={(v) => form.setValue("inviteStudent", v === true, { shouldDirty: true })}
                    className="mt-0.5"
                  />
                  <span>
                    Invite the student to sign in
                    <span className="block text-sm text-muted-foreground">To the student&apos;s email above.</span>
                  </span>
                </label>
              )}
            </CardContent>
          </Card>
        )}

        {!isEdit && panels?.survey && (
          <Card>
            <CardHeader>
              <CardTitle>Survey</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="heardFrom"
                label="How did you hear about us?"
                placeholder="Not asked"
                options={HEARD_FROM.map((h) => ({ value: h, label: h }))}
              />
            </CardContent>
          </Card>
        )}

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
