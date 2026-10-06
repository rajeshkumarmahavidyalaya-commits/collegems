"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { BookMarked, Download, ExternalLink, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/components/providers/i18n-provider";
import { materialDownloadUrl } from "../homework/actions";
import type { Chapter, LessonRow } from "./actions";

// Behind a click, so it is loaded on the click (docs/performance.md).
const MaterialDialog = dynamic(() => import("../study-material/material-list").then((m) => m.MaterialDialog));

type Option = { value: string; label: string };

export function LessonList({
  lessons,
  canManage,
  sections,
  sectionLevels,
  subjects,
  chapters,
}: {
  lessons: LessonRow[];
  canManage: boolean;
  sections: Option[];
  sectionLevels: Record<string, string>;
  subjects: Option[];
  chapters: Chapter[];
}) {
  const { formatDate } = useI18n();
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("all");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const subjectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of lessons) if (l.subjectId) seen.set(l.subjectId, l.subjectName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [lessons]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lessons
      .filter((l) => subject === "all" || l.subjectId === subject)
      .filter((l) => !q || `${l.title} ${l.description ?? ""} ${l.chapterTitle}`.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          a.subjectName.localeCompare(b.subjectName) ||
          a.chapterPosition - b.chapterPosition ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      );
  }, [lessons, query, subject]);

  function openLesson(row: LessonRow) {
    if (row.externalUrl && !row.hasFile) {
      window.open(row.externalUrl, "_blank", "noopener,noreferrer");
      return;
    }
    start(async () => {
      const r = await materialDownloadUrl(row.id);
      if (!r.ok) return void toast.error(r.error);
      window.open(r.data.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="lesson-search">Search lessons</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="lesson-search"
              className="ps-8"
              placeholder="Search lessons by title or keyword…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lesson-subject">Subject</Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger id="lesson-subject" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {subjectOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add New Lesson
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {shown.length === lessons.length
          ? `${lessons.length} ${lessons.length === 1 ? "lesson" : "lessons"} this year.`
          : `${shown.length} of ${lessons.length} lessons match.`}
      </p>

      {lessons.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-card py-14 text-center">
          <span className="rounded-full bg-muted p-3">
            <BookMarked className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium">No lessons yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {canManage
              ? "A lesson is a file or a link placed in a chapter of a class's syllabus. Add the chapters on the syllabus first."
              : "Lessons your teachers publish for your class appear here."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Chapter</TableHead>
                <TableHead>Created On</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No lesson matches. Try another word or subject.
                  </TableCell>
                </TableRow>
              ) : (
                shown.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      {l.title}
                      {!l.isPublished && (
                        <Badge variant="outline" className="ms-2">
                          Not published
                        </Badge>
                      )}
                      {l.description && <p className="line-clamp-2 text-xs font-normal text-muted-foreground">{l.description}</p>}
                    </TableCell>
                    <TableCell>{l.sectionLabel}</TableCell>
                    <TableCell>{l.subjectName}</TableCell>
                    <TableCell>{l.chapterTitle}</TableCell>
                    <TableCell>{formatDate(l.createdAt)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => openLesson(l)} disabled={pending}>
                        {l.hasFile ? <Download className="size-4" aria-hidden="true" /> : <ExternalLink className="size-4" aria-hidden="true" />}
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && open && (
        <MaterialDialog
          open={open}
          onOpenChange={setOpen}
          sections={sections}
          subjects={subjects}
          chapters={chapters.map((c) => ({ id: c.id, title: c.title, classLevelId: c.classLevelId, subjectId: c.subjectId }))}
          sectionLevels={sectionLevels}
        />
      )}
    </div>
  );
}
