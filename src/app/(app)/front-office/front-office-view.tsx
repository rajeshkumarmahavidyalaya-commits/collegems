"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ClipboardList,
  DoorOpen,
  GraduationCap,
  Loader2,
  LogOut,
  MessageSquarePlus,
  Phone,
  Plus,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import {
  conversionRate,
  convertSchema,
  durationPhrase,
  ENQUIRY_SOURCES,
  enquirySchema,
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_OUTCOMES,
  followUpPhrase,
  followUpSchema,
  sourceLabel,
  stageLabel,
  stageTone,
  visitorSchema,
  type ConvertInput,
  type EnquiryInput,
  type FollowUpInput,
  type VisitorInput,
} from "@/lib/validations/front-office";
import {
  checkInVisitor,
  checkOutVisitor,
  convertEnquiry,
  createEnquiry,
  logFollowUp,
  type EnquiryRow,
  type FunnelRow,
  type VisitorRow,
} from "./actions";

type Options = { id: string; label: string }[];

export function FrontOfficeView({
  enquiries,
  funnel,
  visitors,
  classLevels,
  sections,
  staff,
  canManage,
  canAdmit,
}: {
  enquiries: EnquiryRow[];
  funnel: FunnelRow[];
  visitors: VisitorRow[];
  classLevels: Options;
  sections: Options;
  staff: Options;
  canManage: boolean;
  canAdmit: boolean;
}) {
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [followUpFor, setFollowUpFor] = useState<EnquiryRow | null>(null);
  const [convertFor, setConvertFor] = useState<EnquiryRow | null>(null);
  const [visitorOpen, setVisitorOpen] = useState(false);

  const rate = conversionRate(funnel);
  const overdue = enquiries.filter((e) => e.overdue).length;
  const inBuilding = visitors.filter((v) => v.checkedOutAt === null).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open enquiries" value={String(enquiries.filter((e) => e.overdue || followUpPhrase(e.nextFollowUpOn)).length || enquiries.filter((e) => stageTone(e.status) === "open").length)} />
        <Stat
          label="Overdue follow-ups"
          value={String(overdue)}
          tone={overdue > 0 ? "warn" : undefined}
        />
        <Stat
          label="Conversion"
          value={rate === null ? "—" : `${rate}%`}
          hint={rate === null ? "Nothing settled yet" : "of enquiries that finished"}
        />
        <Stat label="In the building" value={String(inBuilding)} />
      </div>

      <Tabs defaultValue="enquiries">
        <TabsList>
          <TabsTrigger value="enquiries">Enquiries</TabsTrigger>
          <TabsTrigger value="gate">Gate</TabsTrigger>
        </TabsList>

        <TabsContent value="enquiries" className="mt-4 flex flex-col gap-4">
          <Funnel funnel={funnel} />
          <EnquiryTable
            enquiries={enquiries}
            canManage={canManage}
            canAdmit={canAdmit}
            onAdd={() => setEnquiryOpen(true)}
            onFollowUp={setFollowUpFor}
            onConvert={setConvertFor}
          />
        </TabsContent>

        <TabsContent value="gate" className="mt-4">
          <GateTable
            visitors={visitors}
            canManage={canManage}
            onAdd={() => setVisitorOpen(true)}
          />
        </TabsContent>
      </Tabs>

      <EnquiryDialog
        open={enquiryOpen}
        onOpenChange={setEnquiryOpen}
        classLevels={classLevels}
        staff={staff}
      />
      <FollowUpDialog enquiry={followUpFor} onClose={() => setFollowUpFor(null)} />
      <ConvertDialog
        enquiry={convertFor}
        onClose={() => setConvertFor(null)}
        sections={sections}
      />
      <VisitorDialog open={visitorOpen} onOpenChange={setVisitorOpen} staff={staff} />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
          tone === "warn" ? "text-[color:var(--color-accent)]" : ""
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The funnel as a row of counts. Deliberately not a chart: six numbers and
 * their shares read faster than any drawing of them, and this is a screen
 * somebody glances at between phone calls.
 */
function Funnel({ funnel }: { funnel: FunnelRow[] }) {
  const total = funnel.reduce((sum, f) => sum + f.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>This year&apos;s funnel</CardTitle>
        <CardDescription>
          {total} {total === 1 ? "enquiry" : "enquiries"} logged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-wrap gap-2">
          {funnel.map((stage) => {
            const tone = stageTone(stage.status);
            return (
              <li
                key={stage.status}
                className="flex min-w-28 flex-1 flex-col gap-1 rounded-md border border-border p-3"
              >
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {stageLabel(stage.status)}
                </span>
                <span className="font-mono text-xl font-semibold tabular-nums">{stage.count}</span>
                <span
                  className={`text-xs ${
                    tone === "lost" ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {stage.share}%
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function EnquiryTable({
  enquiries,
  canManage,
  canAdmit,
  onAdd,
  onFollowUp,
  onConvert,
}: {
  enquiries: EnquiryRow[];
  canManage: boolean;
  canAdmit: boolean;
  onAdd: () => void;
  onFollowUp: (enquiry: EnquiryRow) => void;
  onConvert: (enquiry: EnquiryRow) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Enquiries</CardTitle>
          <CardDescription className="max-w-2xl">
            Sorted by who needs ringing back first. An enquiry with no phone number and no email
            cannot be created at all — it is the one thing this register exists to prevent.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={onAdd} className="cursor-pointer">
            <Plus className="size-4" aria-hidden="true" />
            New enquiry
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {enquiries.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <ClipboardList className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">No enquiries this year</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Every family that telephones or walks in belongs here, so the school can say who it
                spoke to and what happened next.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Enquiry</TableHead>
                  <TableHead>Child</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Follow up</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enquiries.map((e) => {
                  const phrase = followUpPhrase(e.nextFollowUpOn);
                  const tone = stageTone(e.status);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.enquiryNumber}</TableCell>
                      <TableCell>
                        <span className="font-medium">{e.applicantName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {e.classLevelName ?? "Class not settled"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span>{e.contactName}</span>
                        {e.contactPhone && (
                          <a
                            href={`tel:${e.contactPhone}`}
                            className="block font-mono text-xs underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {e.contactPhone}
                          </a>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {sourceLabel(e.source)}
                      </TableCell>
                      <TableCell>
                        {/* Text carries the meaning; the variant echoes it. */}
                        <Badge
                          variant={
                            tone === "won" ? "default" : tone === "lost" ? "destructive" : "outline"
                          }
                        >
                          {stageLabel(e.status)}
                        </Badge>
                        {e.lostReason && (
                          <span className="block max-w-40 truncate text-xs text-muted-foreground">
                            {e.lostReason}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {phrase ? (
                          <span
                            className={
                              e.overdue
                                ? "text-sm font-medium text-[color:var(--color-accent)]"
                                : "text-sm text-muted-foreground"
                            }
                          >
                            {phrase}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {e.followUpCount} contact{e.followUpCount === 1 ? "" : "s"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && e.status !== "admitted" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="cursor-pointer"
                            onClick={() => onFollowUp(e)}
                          >
                            <MessageSquarePlus className="size-4" aria-hidden="true" />
                            <span className="sr-only">Log a contact for {e.applicantName}</span>
                          </Button>
                        )}
                        {canAdmit && e.status !== "admitted" && e.status !== "lost" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="cursor-pointer"
                            onClick={() => onConvert(e)}
                          >
                            <GraduationCap className="size-4" aria-hidden="true" />
                            <span className="sr-only">Admit {e.applicantName}</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GateTable({
  visitors,
  canManage,
  onAdd,
}: {
  visitors: VisitorRow[];
  canManage: boolean;
  onAdd: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function signOut(row: VisitorRow) {
    startTransition(async () => {
      const result = await checkOutVisitor(row.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(`${row.visitorName} signed out.`);
        router.refresh();
      }
    });
  }

  const inside = visitors.filter((v) => v.checkedOutAt === null);
  const gone = visitors.filter((v) => v.checkedOutAt !== null);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Gate register</CardTitle>
          <CardDescription className="max-w-2xl">
            {inside.length} in the building. The same phone number cannot be signed in twice — a
            register that answers &ldquo;who is here&rdquo; is worthless if nobody signs people out.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={onAdd} className="cursor-pointer">
            <Plus className="size-4" aria-hidden="true" />
            Sign somebody in
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {visitors.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <DoorOpen className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">Nobody has signed in today</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Every visitor gets a pass number, and the register says who they came to see.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pass</TableHead>
                  <TableHead>Visitor</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Seeing</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Time</TableHead>
                  {canManage && <TableHead className="w-16 text-right">Out</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...inside, ...gone].map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-xs">{v.passNumber}</TableCell>
                    <TableCell>
                      <span className="font-medium">{v.visitorName}</span>
                      {v.organisation && (
                        <span className="block text-xs text-muted-foreground">
                          {v.organisation}
                        </span>
                      )}
                      {v.phone && (
                        <a
                          href={`tel:${v.phone}`}
                          className="block font-mono text-xs underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {v.phone}
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="max-w-56 text-muted-foreground">{v.purpose}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {v.hostName ?? v.studentName ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">
                      {new Date(v.checkedInAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell>
                      {v.checkedOutAt ? (
                        <span className="text-sm text-muted-foreground">
                          {durationPhrase(v.minutesInside)}
                        </span>
                      ) : (
                        <Badge variant="outline">
                          Inside {durationPhrase(v.minutesInside)}
                        </Badge>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {v.checkedOutAt === null && (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            className="cursor-pointer"
                            onClick={() => signOut(v)}
                          >
                            <LogOut className="size-4" aria-hidden="true" />
                            <span className="sr-only">Sign out {v.visitorName}</span>
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EnquiryDialog({
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
            This does not create a student. It records a family that asked, so somebody can ring
            them back and the school can say what happened.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="applicantFirstName"
                label="Child's first name"
                required
              />
              <TextField control={form.control} name="applicantLastName" label="Last name" />
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
              <TextField control={form.control} name="dateOfBirth" label="Date of birth" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="contactName" label="Contact name" required />
              <TextField control={form.control} name="relationship" label="Relationship" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="contactPhone"
                label="Phone"
                description="A phone number or an email is required."
              />
              <TextField control={form.control} name="contactEmail" label="Email" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="source"
                label="How they reached us"
                options={ENQUIRY_SOURCES.map((s) => ({ value: s.value, label: s.label }))}
              />
              <TextField control={form.control} name="nextFollowUpOn" label="Follow up on" />
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

            <TextareaField control={form.control} name="notes" label="Notes" rows={2} />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="cursor-pointer">
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Log enquiry
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpDialog({
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
            {enquiry?.applicantName} · {enquiry?.contactName}. The log cannot be edited afterwards —
            a call record that can be tidied is not a record of what happened.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <SelectField
              control={form.control}
              name="channel"
              label="How"
              options={FOLLOW_UP_CHANNELS.map((c) => ({ value: c.value, label: c.label }))}
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
                ...FOLLOW_UP_OUTCOMES.map((o) => ({ value: o.value, label: o.label })),
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
              <TextField control={form.control} name="nextFollowUpOn" label="Next follow-up" />
            )}

            <DialogFooter>
              <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="cursor-pointer">
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

function ConvertDialog({
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
            This creates the person, the student and the enrolment through the school&apos;s one
            admission path, and closes the enquiry against it. It cannot be done twice.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

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
              <TextField control={form.control} name="rollNumber" label="Roll number" />
              <TextField control={form.control} name="admissionDate" label="Admission date" />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="cursor-pointer">
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

function VisitorDialog({
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
            Record the last four characters of an identity document, never the whole number and
            never a scan — a photocopy of somebody&apos;s ID at a school gate is a liability.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="visitorName" label="Name" required />
              <TextField control={form.control} name="phone" label="Phone" />
            </div>
            <TextField control={form.control} name="purpose" label="Purpose" required />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="organisation" label="Organisation" />
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
              <TextField control={form.control} name="idProofKind" label="ID type" />
              <TextField control={form.control} name="idProofLast4" label="Last 4" />
              <TextField control={form.control} name="vehicleNumber" label="Vehicle" />
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
              <Button type="submit" disabled={pending} className="cursor-pointer">
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Issue pass
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
