"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import {
  ClipboardList,
  DoorOpen,
  GraduationCap,
  LogOut,
  MessageSquarePlus,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useI18n } from "@/components/providers/i18n-provider";

import {
  conversionRate,
  durationPhrase,
  followUpPhrase,
  sourceLabel,
  stageLabel,
  stageTone,
} from "@/lib/validations/front-office-display";
import {
  checkOutVisitor,
  type EnquiryRow,
  type FunnelRow,
  type VisitorRow,
} from "./actions";
import dynamic from "next/dynamic";

// Loaded on the click that opens them and rendered only while open: they
// hold this page's Zod and form code, and a conditional render is not a
// conditional load (see `fees-table.tsx` and docs/performance.md).
const EnquiryDialog = dynamic(() =>
  import("./front-office-dialogs").then((m) => m.EnquiryDialog),
);
const FollowUpDialog = dynamic(() =>
  import("./front-office-dialogs").then((m) => m.FollowUpDialog),
);
const ConvertDialog = dynamic(() =>
  import("./front-office-dialogs").then((m) => m.ConvertDialog),
);
const VisitorDialog = dynamic(() =>
  import("./front-office-dialogs").then((m) => m.VisitorDialog),
);

export type Options = { id: string; label: string }[];

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
        <Stat
          label="Open enquiries"
          value={String(
            enquiries.filter(
              (e) => e.overdue || followUpPhrase(e.nextFollowUpOn),
            ).length ||
              enquiries.filter((e) => stageTone(e.status) === "open").length,
          )}
        />
        <Stat
          label="Overdue follow-ups"
          value={String(overdue)}
          tone={overdue > 0 ? "warn" : undefined}
        />
        <Stat
          label="Conversion"
          value={rate === null ? "—" : `${rate}%`}
          hint={
            rate === null ? "Nothing settled yet" : "of enquiries that finished"
          }
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

      {enquiryOpen ? (
        <EnquiryDialog
          open={enquiryOpen}
          onOpenChange={setEnquiryOpen}
          classLevels={classLevels}
          staff={staff}
        />
      ) : null}
      {followUpFor ? (
        <FollowUpDialog
          enquiry={followUpFor}
          onClose={() => setFollowUpFor(null)}
        />
      ) : null}
      {convertFor ? (
        <ConvertDialog
          enquiry={convertFor}
          onClose={() => setConvertFor(null)}
          sections={sections}
        />
      ) : null}
      {visitorOpen ? (
        <VisitorDialog
          open={visitorOpen}
          onOpenChange={setVisitorOpen}
          staff={staff}
        />
      ) : null}
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
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
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
  const { t } = useI18n();
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
                  {stageLabel(stage.status, t)}
                </span>
                <span className="font-mono text-xl font-semibold tabular-nums">
                  {stage.count}
                </span>
                <span
                  className={`text-xs ${
                    tone === "lost"
                      ? "text-destructive"
                      : "text-muted-foreground"
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
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Enquiries</CardTitle>
          <CardDescription className="max-w-2xl">
            Sorted by who needs ringing back first. An enquiry with no phone
            number and no email cannot be created at all — it is the one thing
            this register exists to prevent.
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
              <ClipboardList
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div>
              <p className="font-medium">No enquiries this year</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Every family that telephones or walks in belongs here, so the
                school can say who it spoke to and what happened next.
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
                  <TableHead className="w-32 text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enquiries.map((e) => {
                  const phrase = followUpPhrase(e.nextFollowUpOn);
                  const tone = stageTone(e.status);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">
                        {e.enquiryNumber}
                      </TableCell>
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
                        {sourceLabel(e.source, t)}
                      </TableCell>
                      <TableCell>
                        {/* Text carries the meaning; the variant echoes it. */}
                        <Badge
                          variant={
                            tone === "won"
                              ? "default"
                              : tone === "lost"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {stageLabel(e.status, t)}
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
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {e.followUpCount} contact
                          {e.followUpCount === 1 ? "" : "s"}
                        </span>
                      </TableCell>
                      <TableCell className="text-end">
                        {canManage && e.status !== "admitted" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="cursor-pointer"
                            onClick={() => onFollowUp(e)}
                          >
                            <MessageSquarePlus
                              className="size-4"
                              aria-hidden="true"
                            />
                            <span className="sr-only">
                              Log a contact for {e.applicantName}
                            </span>
                          </Button>
                        )}
                        {canAdmit &&
                          e.status !== "admitted" &&
                          e.status !== "lost" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="cursor-pointer"
                              onClick={() => onConvert(e)}
                            >
                              <GraduationCap
                                className="size-4"
                                aria-hidden="true"
                              />
                              <span className="sr-only">
                                Admit {e.applicantName}
                              </span>
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
  const { formatTime } = useI18n();
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
            {inside.length} in the building. The same phone number cannot be
            signed in twice — a register that answers &ldquo;who is here&rdquo;
            is worthless if nobody signs people out.
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
              <DoorOpen
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div>
              <p className="font-medium">Nobody has signed in today</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Every visitor gets a pass number, and the register says who they
                came to see.
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
                  {canManage && (
                    <TableHead className="w-16 text-end">Out</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...inside, ...gone].map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-xs">
                      {v.passNumber}
                    </TableCell>
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
                    <TableCell className="max-w-56 text-muted-foreground">
                      {v.purpose}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {v.hostName ?? v.studentName ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">
                      {formatTime(v.checkedInAt)}
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
                      <TableCell className="text-end">
                        {v.checkedOutAt === null && (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            className="cursor-pointer"
                            onClick={() => signOut(v)}
                          >
                            <LogOut className="size-4" aria-hidden="true" />
                            <span className="sr-only">
                              Sign out {v.visitorName}
                            </span>
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
