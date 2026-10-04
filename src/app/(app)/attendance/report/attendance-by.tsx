"use client";

import { useMemo, useState, useTransition } from "react";
import { CalendarDays, Eye, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExportRowsButton } from "@/components/export-rows-button";
import { useI18n } from "@/components/providers/i18n-provider";
import { attendanceSheet, type ClassFilter, type SheetRow } from "../by-actions";

const ALL = "all";

/** One letter a register uses, and the word a screen reader hears for it. */
const MARK: Record<string, { letter: string; word: string; className: string }> = {
  present: { letter: "P", word: "Present", className: "text-success" },
  absent: { letter: "A", word: "Absent", className: "font-semibold text-destructive" },
  late: { letter: "L", word: "Late", className: "font-medium text-foreground" },
  excused: { letter: "E", word: "Excused", className: "text-muted-foreground" },
};

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysOf(month: string, weekday: (iso: string) => string): { day: number; weekday: string; sunday: boolean }[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return [];
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
    return {
      day: i + 1,
      weekday: weekday(iso),
      sunday: new Date(y, m - 1, i + 1).getDay() === 0,
    };
  });
}

/**
 * The reference's View Attendance: Attendance By Month, or By Subject, for a
 * class, one section or all of them, and a month. By month reads the daily
 * register; by subject reads the subject register (0329). The grid is a day
 * per column with the four totals at the end, and attended is present plus
 * late, over what was marked -- never over the calendar.
 */
export function AttendanceBy({ classes }: { classes: ClassFilter[] }) {
  const { formatDate } = useI18n();
  const [by, setBy] = useState<"month" | "subject">("month");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState(ALL);
  const [subjectId, setSubjectId] = useState("");
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [asked, setAsked] = useState<{ by: string; title: string; month: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cls = classes.find((c) => c.id === classId) ?? null;
  // Subjects taught in the chosen section, or in any section of the class.
  const subjects = useMemo(() => {
    if (!cls) return [];
    const pool = sectionId === ALL ? cls.sections : cls.sections.filter((s) => s.id === sectionId);
    const seen = new Map<string, string>();
    for (const s of pool) for (const sub of s.subjects) seen.set(sub.id, sub.name);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [cls, sectionId]);

  const days = useMemo(
    () => daysOf(asked?.month ?? month, (iso) => formatDate(iso, { weekday: "narrow" })),
    [asked, month, formatDate],
  );

  function view(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!classId) return setError("Choose a class.");
    if (!month) return setError("Choose a month.");
    if (by === "subject" && !subjectId) return setError("Choose a subject.");
    startTransition(async () => {
      const r = await attendanceSheet({
        by,
        classLevelId: classId,
        sectionId: sectionId === ALL ? null : sectionId,
        subjectId: by === "subject" ? subjectId : null,
        month,
      });
      if (!r.ok) {
        setRows(null);
        setError(r.error);
        return;
      }
      const sectionName = sectionId === ALL ? "All Sections" : cls?.sections.find((s) => s.id === sectionId)?.name;
      const subjectName = subjects.find((s) => s.id === subjectId)?.name;
      setRows(r.rows);
      setAsked({
        by,
        month,
        title: [cls?.name, sectionName, by === "subject" ? subjectName : null].filter(Boolean).join(" · "),
      });
    });
  }

  const monthLabel = asked
    ? formatDate(`${asked.month}-01`, { month: "long", year: "numeric" })
    : "";
  const allSections = sectionId === ALL;

  const exportRows = rows
    ? [
        ["Roll", "Admission No.", "Name", "Section", ...days.map((d) => String(d.day)), "Present", "Absent", "Late", "Excused", "Attended %"],
        ...rows.map((r) => {
          const marked = r.present + r.absent + r.late;
          const pct = marked > 0 ? (((r.present + r.late) / marked) * 100).toFixed(1) : "";
          return [
            r.rollNumber ?? "",
            r.admissionNumber,
            r.fullName,
            r.sectionName,
            ...days.map((d) => MARK[r.marks[String(d.day)]]?.letter ?? ""),
            String(r.present),
            String(r.absent),
            String(r.late),
            String(r.excused),
            pct,
          ];
        }),
      ]
    : [];

  return (
    <section className="flex flex-col gap-4" aria-labelledby="attendance-by-title">
      <form onSubmit={view} className="overflow-hidden rounded-lg border bg-card" noValidate>
        <div className="bg-primary px-4 py-3 text-center text-primary-foreground">
          <h2 id="attendance-by-title" className="text-lg font-semibold">
            Attendance By
          </h2>
          <p className="text-sm italic opacity-90">Select class, section, month and by subject.</p>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
            <legend className="sr-only">Kind of report</legend>
            {(
              [
                ["month", "Attendance By Month"],
                ["subject", "Attendance By Subject"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="attendance-by"
                  value={value}
                  checked={by === value}
                  onChange={() => {
                    setBy(value);
                    setRows(null);
                    setAsked(null);
                  }}
                  className="size-4 accent-[var(--primary)]"
                />
                {label}
              </label>
            ))}
          </fieldset>

          <div className={`grid gap-4 sm:grid-cols-2 ${by === "subject" ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="by-class">
                <span className="text-destructive" aria-hidden="true">* </span>Class:
              </Label>
              <Select
                value={classId || undefined}
                onValueChange={(v) => {
                  setClassId(v);
                  setSectionId(ALL);
                  setSubjectId("");
                }}
              >
                <SelectTrigger id="by-class" className="w-full">
                  <SelectValue placeholder={classes.length ? "Select Class" : "No classes yet"} />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="by-section">
                <span className="text-destructive" aria-hidden="true">* </span>Section:
              </Label>
              <Select
                value={sectionId}
                onValueChange={(v) => {
                  setSectionId(v);
                  setSubjectId("");
                }}
                disabled={!cls}
              >
                <SelectTrigger id="by-section" className="w-full">
                  <SelectValue placeholder="All Sections" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Sections</SelectItem>
                  {(cls?.sections ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {by === "subject" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="by-subject">
                  <span className="text-destructive" aria-hidden="true">* </span>Subject:
                </Label>
                <Select value={subjectId || undefined} onValueChange={setSubjectId} disabled={!cls}>
                  <SelectTrigger id="by-subject" className="w-full">
                    <SelectValue
                      placeholder={!cls ? "Choose a class first" : subjects.length ? "Select Subject" : "No subjects in this class"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="by-month">
                <span className="text-destructive" aria-hidden="true">* </span>Month:
              </Label>
              <Input id="by-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-center border-t bg-muted/30 px-4 py-3">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            View Attendance
          </Button>
        </div>
      </form>

      <div aria-live="polite">
        {rows && asked && (
          <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="flex items-center gap-2 font-semibold">
                <CalendarDays className="size-4 text-primary" aria-hidden="true" />
                {asked.by === "subject" ? "Attendance By Subject" : "Attendance By Month"}: {asked.title} — {monthLabel}
              </h3>
              <div className="ms-auto flex gap-2" data-print="hide">
                <ExportRowsButton rows={exportRows} fileName={`attendance-${asked.month}.csv`} />
                <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="size-4" aria-hidden="true" />
                  Print
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              P present · A absent · L late · E excused · blank: not marked. Attended counts present
              and late, over the days marked; excused days are left out.
            </p>
            {rows.length === 0 ? (
              <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {asked.by === "subject"
                  ? "No student you can see takes this subject in this class."
                  : "No student you can see is in this class. A class teacher sees their own class; the office sees every class."}
              </p>
            ) : (
              <div className="max-w-full overflow-x-auto rounded-md border">
                <table className="w-max min-w-full border-collapse text-sm">
                  <caption className="sr-only">
                    {asked.title}, {monthLabel}
                  </caption>
                  <thead className="bg-muted/60">
                    <tr>
                      <th scope="col" className="sticky start-0 z-10 bg-muted px-2 py-2 text-start">
                        Student
                      </th>
                      {allSections && (
                        <th scope="col" className="px-2 py-2 text-start">
                          Section
                        </th>
                      )}
                      {days.map((d) => (
                        <th
                          key={d.day}
                          scope="col"
                          className={`w-7 px-0.5 py-1 text-center text-xs font-medium ${d.sunday ? "text-muted-foreground" : ""}`}
                        >
                          <span className="block">{d.day}</span>
                          <span className="block text-[10px] font-normal">{d.weekday}</span>
                        </th>
                      ))}
                      {["P", "A", "L", "E", "%"].map((h) => (
                        <th key={h} scope="col" className="px-2 py-2 text-center">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const marked = r.present + r.absent + r.late;
                      const pct = marked > 0 ? ((r.present + r.late) / marked) * 100 : null;
                      return (
                        <tr key={`${r.studentId}-${r.sectionName}`} className="border-t">
                          <th scope="row" className="sticky start-0 z-10 bg-card px-2 py-1.5 text-start font-normal">
                            <span className="block font-medium">{r.fullName}</span>
                            <span className="block text-xs text-muted-foreground">
                              {r.rollNumber ? `Roll ${r.rollNumber} · ` : ""}
                              {r.admissionNumber}
                            </span>
                          </th>
                          {allSections && <td className="px-2 py-1.5">{r.sectionName}</td>}
                          {days.map((d) => {
                            const m = MARK[r.marks[String(d.day)]];
                            return (
                              <td
                                key={d.day}
                                className={`px-0.5 py-1.5 text-center ${d.sunday ? "bg-muted/40" : ""} ${m?.className ?? ""}`}
                              >
                                {m ? <abbr title={m.word} className="no-underline">{m.letter}</abbr> : ""}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 text-center tabular-nums">{r.present}</td>
                          <td className="px-2 py-1.5 text-center tabular-nums">{r.absent}</td>
                          <td className="px-2 py-1.5 text-center tabular-nums">{r.late}</td>
                          <td className="px-2 py-1.5 text-center tabular-nums">{r.excused}</td>
                          <td className="px-2 py-1.5 text-center tabular-nums">{pct === null ? "—" : `${pct.toFixed(0)}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
