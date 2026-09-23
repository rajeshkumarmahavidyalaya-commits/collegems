"use client";

import { useMemo, useState, useTransition } from "react";

import Link from "next/link";

import { useRouter } from "next/navigation";

import {
  BookMarked,
  CalendarClock,
  CheckCircle2,
  NotebookPen,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Trash2,
  Undo2,
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

import { Label } from "@/components/ui/label";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { dueLabel } from "@/lib/validations/homework-display";

import { useI18n } from "@/components/providers/i18n-provider";

import {
  deleteHomework,
  publishHomework,
  unpublishHomework,
  type CurriculumOption,
  type HomeworkRow,
} from "./actions";
import dynamic from "next/dynamic";

// Loaded on the click that opens them and rendered only while open: they
// hold this page's Zod and form code, and a conditional render is not a
// conditional load (see `fees-table.tsx` and docs/performance.md).
const HomeworkDialog = dynamic(() =>
  import("./homework-dialog").then((m) => m.HomeworkDialog),
);

type Props = {
  homework: HomeworkRow[];
  curriculum: CurriculumOption[];
  today: string;
  canManage: boolean;
};

export function HomeworkList({
  homework,
  curriculum,
  today,
  canManage,
}: Props) {
  const { formatDate, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HomeworkRow | null>(null);
  const [sectionFilter, setSectionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const sections = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of curriculum) seen.set(row.sectionId, row.sectionLabel);
    for (const row of homework)
      if (!seen.has(row.sectionId)) seen.set(row.sectionId, row.sectionLabel);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [curriculum, homework]);

  const rows = homework.filter(
    (h) =>
      (sectionFilter === "all" || h.sectionId === sectionFilter) &&
      (statusFilter === "all" || h.status === statusFilter),
  );

  function publish(row: HomeworkRow) {
    startTransition(async () => {
      const result = await publishHomework(row.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.created === 1
          ? "Set. One student now has this to do."
          : `Set. ${result.data.created} students now have this to do.`,
      );
      router.refresh();
    });
  }

  function unpublish(row: HomeworkRow) {
    startTransition(async () => {
      const result = await unpublishHomework(row.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Back to a draft. The class can no longer see it.");
      router.refresh();
    });
  }

  function remove(row: HomeworkRow) {
    const extra =
      row.handedIn > 0
        ? ` ${row.handedIn} ${row.handedIn === 1 ? "piece" : "pieces"} of work already handed in, and every file with it, will be deleted too.`
        : "";
    if (
      !window.confirm(`Delete "${row.title}"?${extra} This cannot be undone.`)
    )
      return;

    startTransition(async () => {
      const result = await deleteHomework(row.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Homework deleted.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Homework</CardTitle>
          <CardDescription className="max-w-2xl">
            A draft is yours alone. Setting it creates a row for every student
            in the class, so &ldquo;not handed in&rdquo; is something you can
            see on Tuesday morning rather than something you have to infer.
          </CardDescription>
        </div>
        {canManage && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Set homework
          </Button>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {homework.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="hw-section-filter"
                className="text-xs text-muted-foreground"
              >
                Class
              </Label>
              <Select value={sectionFilter} onValueChange={setSectionFilter}>
                <SelectTrigger id="hw-section-filter" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every class</SelectItem>
                  {sections.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="hw-status-filter"
                className="text-xs text-muted-foreground"
              >
                Status
              </Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="hw-status-filter" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Drafts and set</SelectItem>
                  <SelectItem value="draft">Drafts only</SelectItem>
                  <SelectItem value="published">Set only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {homework.length === 0 ? (
          <EmptyState
            canManage={canManage}
            onAdd={() => {
              setEditing(null);
              setOpen(true);
            }}
          />
        ) : rows.length === 0 ? (
          <div className="py-12 text-center">
            <p className="font-medium">Nothing matches those filters</p>
            <p className="mt-1 text-sm text-muted-foreground">
              There is homework here, just not for that class and status
              together.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setSectionFilter("all");
                setStatusFilter("all");
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Homework</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-end">Handed in</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-40 text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/homework/${row.id}`}
                        className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.title}
                      </Link>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{row.subjectName}</span>
                        {row.maxMarks !== null && (
                          <span>· out of {row.maxMarks}</span>
                        )}
                        {row.attachmentCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Paperclip className="size-3" aria-hidden="true" />
                            {row.attachmentCount}
                          </span>
                        )}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.sectionLabel}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {formatDate(`${row.dueOn}T00:00:00Z`, {
                          day: "2-digit",
                          month: "short",
                          timeZone: "UTC",
                        })}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {dueLabel(row.dueOn, today, t)}
                      </p>
                    </TableCell>
                    <TableCell className="text-end font-mono tabular-nums">
                      {row.collectsSubmissions ? (
                        <>
                          {row.handedIn}
                          <span className="text-muted-foreground">
                            {" "}
                            / {row.setCount}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "published" ? "default" : "outline"
                        }
                      >
                        {row.status === "published" ? "Set" : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          {row.status === "draft" ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={pending}
                              onClick={() => publish(row)}
                              aria-label={`Set ${row.title} for the class`}
                              title="Set for the class"
                            >
                              <Send className="size-4" aria-hidden="true" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={pending || row.handedIn > 0}
                              onClick={() => unpublish(row)}
                              aria-label={`Return ${row.title} to a draft`}
                              title={
                                row.handedIn > 0
                                  ? "Work has been handed in, so this cannot go back to a draft"
                                  : "Return to a draft"
                              }
                            >
                              <Undo2 className="size-4" aria-hidden="true" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditing(row);
                              setOpen(true);
                            }}
                            aria-label={`Edit ${row.title}`}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            onClick={() => remove(row)}
                            aria-label={`Delete ${row.title}`}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {open ? (
        <HomeworkDialog
          open={open}
          onOpenChange={setOpen}
          homework={editing}
          curriculum={curriculum}
          today={today}
        />
      ) : null}
    </Card>
  );
}

function EmptyState({
  canManage,
  onAdd,
}: {
  canManage: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <span className="rounded-full bg-muted p-3">
        <NotebookPen
          className="size-6 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <div>
        <p className="font-medium">No homework yet</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Set a piece of work for a class you teach. Not everything needs
          collecting — &ldquo;finish exercise 4&rdquo; is homework too, and
          marking it as uncollected keeps the submissions screen honest.
        </p>
      </div>
      {canManage && (
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="size-4" aria-hidden="true" />
          Set homework
        </Button>
      )}
    </div>
  );
}

export function HomeworkSummary({ homework }: { homework: HomeworkRow[] }) {
  const set = homework.filter((h) => h.status === "published");
  const collecting = set.filter((h) => h.collectsSubmissions);
  const outstanding = collecting.reduce(
    (sum, h) => sum + (h.setCount - h.handedIn),
    0,
  );
  const toMark = collecting.reduce(
    (sum, h) => sum + (h.handedIn - h.marked),
    0,
  );

  const cards = [
    { label: "Set this session", value: set.length, icon: BookMarked },
    { label: "Still to hand in", value: outstanding, icon: CalendarClock },
    { label: "Waiting to be marked", value: toMark, icon: CheckCircle2 },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="flex items-center gap-3 py-5">
            <span className="rounded-lg bg-muted p-2">
              <card.icon
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div>
              <p className="font-mono text-2xl font-semibold tabular-nums">
                {card.value}
              </p>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
