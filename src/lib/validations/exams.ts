import { z } from "zod";

/**
 * Phase 3.1 — exams, marks, and grading rules as data.
 *
 * The schemas here validate the *shape* of a grading scheme. Whether the rules
 * make sense is a different question, answered by `grading_scheme_problems()`
 * in Postgres — deliberately, because the engine that reads the rules and the
 * thing that criticises them must never drift apart, and only one of them can
 * live next to the evaluation order.
 */

export const EXAM_KINDS = [
  { value: "unit", label: "Unit test" },
  { value: "term", label: "Term exam" },
  { value: "half_yearly", label: "Half-yearly" },
  { value: "annual", label: "Annual" },
  { value: "practical", label: "Practical" },
  { value: "other", label: "Other" },
] as const;

export const AGGREGATE_METHODS = [
  {
    value: "weighted",
    label: "Every subject counts",
    hint: "Each subject contributes in proportion to its weight.",
  },
  {
    value: "best_of",
    label: "Best N subjects count",
    hint: "Only a student's strongest subjects are aggregated; the rest are shown but dropped.",
  },
] as const;

export const RANK_SCOPES = [
  {
    value: "section",
    label: "Within the section",
    hint: "Position among the children in the same class and section.",
  },
  {
    value: "class_level",
    label: "Within the class",
    hint: "Position across every section of the class level.",
  },
  {
    value: "school",
    label: "Across the school",
    hint: "One position per student across every class sitting the exam.",
  },
] as const;

export const RANK_METHODS = [
  {
    value: "competition",
    label: "Standard (1, 2, 2, 4)",
    hint: "Two students tied for second are both second, and the next is fourth.",
  },
  {
    value: "dense",
    label: "Dense (1, 2, 2, 3)",
    hint: "Two students tied for second are both second, and the next is third.",
  },
] as const;

export const RESULT_STATES = [
  { value: "pass", label: "Pass", tone: "success" },
  { value: "fail", label: "Fail", tone: "danger" },
  { value: "incomplete", label: "Incomplete", tone: "warning" },
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

export const examSchema = z
  .object({
    name: z.string().min(1, "An exam needs a name").max(120),
    kind: z.enum(["unit", "term", "half_yearly", "annual", "practical", "other"]),
    startsOn: z.union([isoDate, z.literal("")]).optional(),
    endsOn: z.union([isoDate, z.literal("")]).optional(),
    gradingSchemeId: z.union([z.string().uuid(), z.literal("")]).optional(),
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, {
    message: "The last day cannot be before the first",
    path: ["endsOn"],
  });
export type ExamInput = z.infer<typeof examSchema>;

export const examPaperSchema = z
  .object({
    sectionId: z.string().uuid("Choose a class"),
    subjectId: z.string().uuid("Choose a subject"),
    maxMarks: z
      .number({ message: "Enter the maximum marks" })
      .positive("The maximum must be above zero")
      .max(1000, "That is higher than any paper this system will mark"),
    passMarks: z.number({ message: "Enter the pass mark" }).min(0, "Cannot be negative"),
    weight: z.number({ message: "Enter a weight" }).positive("A weight must be above zero"),
    isOptional: z.boolean(),
    examDate: z.union([isoDate, z.literal("")]).optional(),
  })
  .refine((v) => v.passMarks <= v.maxMarks, {
    message: "The pass mark cannot exceed the maximum",
    path: ["passMarks"],
  });
export type ExamPaperInput = z.infer<typeof examPaperSchema>;

/**
 * One part of a split paper. `code` is the column heading on the marks grid, so
 * it is short and unique within the paper; the maximum is the part's own, and
 * the parts' maxima have to add up to the paper's — a rule about several rows,
 * which is why it is checked in `exams_set_components` and not here. What *is*
 * checked here is what a single row can be wrong about on its own.
 */
export const examComponentSchema = z
  .object({
    code: z.string().min(1, "A part needs a short code").max(8, "Eight characters at most"),
    name: z.string().min(1, "A part needs a name").max(60),
    maxMarks: z
      .number({ message: "Enter the maximum for this part" })
      .positive("The maximum must be above zero")
      .max(1000, "That is higher than any paper this system will mark"),
    passMarks: z.number({ message: "Enter the minimum" }).min(0, "Cannot be negative"),
  })
  .refine((v) => v.passMarks <= v.maxMarks, {
    message: "The minimum cannot exceed this part's maximum",
    path: ["passMarks"],
  });
export type ExamComponentInput = z.infer<typeof examComponentSchema>;

/**
 * The whole set at once. An empty list means "this paper is not split", which
 * is a legitimate thing to save; a single part is not, because a paper split
 * into one part is a paper.
 */
export const examComponentSetSchema = z
  .object({
    examSubjectId: z.string().uuid(),
    components: z.array(examComponentSchema).max(8, "Eight parts is more than any paper needs"),
  })
  .refine((v) => v.components.length !== 1, {
    message: "Give the paper two or more parts, or none at all",
    path: ["components"],
  })
  .refine(
    (v) => new Set(v.components.map((c) => c.code.trim().toLowerCase())).size === v.components.length,
    { message: "Two parts share a code", path: ["components"] },
  );
export type ExamComponentSetInput = z.infer<typeof examComponentSetSchema>;

/**
 * The other half of "the parts add up to the paper" — said in the browser while
 * somebody is typing, so the total under the form moves as they go. Postgres
 * still enforces it; this only means nobody presses Save to find out.
 */
export function componentTotal(components: { maxMarks: number }[]) {
  return components.reduce((sum, c) => sum + (Number.isFinite(c.maxMarks) ? c.maxMarks : 0), 0);
}

export function componentTotalProblem(
  components: { maxMarks: number }[],
  paperMaxMarks: number,
): string | null {
  if (components.length === 0) return null;
  const total = componentTotal(components);
  if (total === paperMaxMarks) return null;
  const gap = Math.abs(total - paperMaxMarks);
  return `The parts add up to ${total} but the paper is out of ${paperMaxMarks}, so they are ${gap} ${
    total < paperMaxMarks ? "short" : "over"
  }.`;
}

/**
 * One student's cell in the marks grid. `marks` is a string because the input
 * is: an empty box means "not entered yet", which is a different thing from
 * zero, and `z.coerce` would collapse the two — as well as splitting the
 * input/output types and breaking the resolver.
 */
export const markEntrySchema = z.object({
  studentId: z.string().uuid(),
  /** Null for a paper marked as a whole; the part's id for a split one. */
  componentId: z.string().uuid().nullable().default(null),
  marks: z.string(),
  isAbsent: z.boolean(),
  remarks: z.string().max(200).optional(),
});
export type MarkEntryInput = z.infer<typeof markEntrySchema>;

export const markSheetSchema = z.object({
  examSubjectId: z.string().uuid(),
  entries: z.array(markEntrySchema),
});
export type MarkSheetInput = z.infer<typeof markSheetSchema>;

// ---------------------------------------------------------------------------
// Grading schemes
// ---------------------------------------------------------------------------

export const gradeBandSchema = z.object({
  code: z.string().min(1, "A grade needs a code").max(8),
  min_percent: z.number().min(0, "Cannot be below 0").max(100, "Cannot be above 100"),
  point: z.number().min(0).max(10).optional(),
  description: z.string().max(60).optional(),
  is_fail: z.boolean().optional(),
});
export type GradeBand = z.infer<typeof gradeBandSchema>;

export const gradingRulesSchema = z.object({
  grades: z.array(gradeBandSchema).default([]),
  pass: z.object({ aggregate_min_percent: z.number().min(0).max(100) }).optional(),
  grace: z
    .object({
      max_marks: z.number().min(0).max(100),
      max_subjects: z.number().int().min(0).max(20),
    })
    .optional(),
  aggregate: z
    .object({
      method: z.enum(["weighted", "best_of"]),
      best_of: z.number().int().min(1).max(30).nullable().optional(),
    })
    .optional(),
  /**
   * Where a student is ranked, and how ties are handled. A missing `rank` key
   * means the school does not rank -- the conservative reading, and not a
   * hypothetical one: several boards have abolished class rank outright, and a
   * card that invents one is worse than a card without one.
   */
  rank: z
    .object({
      scope: z.enum(["section", "class_level", "school"]),
      method: z.enum(["competition", "dense"]).optional(),
      include: z.enum(["all", "passed"]).optional(),
    })
    .optional(),
  /**
   * Whether every part of a split paper has to be passed on its own, or only
   * the paper's total. Absent means false, and that default is narrower than
   * rule 12's usual "the conservative reading": turning it on by default would
   * change what every scheme already saved means, and fail children who had
   * passed. What keeps the lenient default honest is `exams_problems()`, which
   * says out loud when a paper carries minimums the scheme will not enforce.
   */
  components: z.object({ must_pass_each: z.boolean() }).optional(),
  optional_subject: z
    .object({
      replaces_worst: z.boolean(),
      /**
       * Whether an *absence* may be covered by the additional subject.
       * Defaults to false, and that default is load-bearing: a school that
       * wants the lenient behaviour will say so, whereas a school that gets it
       * by accident will not notice until a parent asks why their child never
       * sat science and passed anyway. See migration 0049.
       */
      replaces_absent: z.boolean().optional(),
    })
    .optional(),
});
export type GradingRules = z.infer<typeof gradingRulesSchema>;

export const gradingSchemeSchema = z.object({
  name: z.string().min(1, "A scheme needs a name").max(120),
  description: z.string().max(400).optional(),
  isDefault: z.boolean(),
  /** The rules arrive as JSON text from a code editor, so parsing is the gate. */
  rules: z.string().min(2, "The rules cannot be empty"),
});
export type GradingSchemeInput = z.infer<typeof gradingSchemeSchema>;

/**
 * Parse the rules a person typed, reporting the one thing they need to know:
 * whether it is JSON at all, and whether it is JSON of the right shape. The
 * deeper question — whether the rules will behave sensibly — belongs to
 * Postgres.
 */
export function parseRules(text: string): { ok: true; rules: unknown } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That is not valid JSON." };
  }

  const result = gradingRulesSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      error: `${first.path.join(".") || "rules"}: ${first.message}`,
    };
  }

  return { ok: true, rules: parsed };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function examKindLabel(value: string) {
  return EXAM_KINDS.find((k) => k.value === value)?.label ?? value;
}

export function resultLabel(value: string) {
  return RESULT_STATES.find((r) => r.value === value)?.label ?? value;
}

export function resultTone(value: string) {
  return RESULT_STATES.find((r) => r.value === value)?.tone ?? "muted";
}

/** `61.5` → `"61.5%"`, and a missing aggregate → an em dash rather than `NaN%`. */
export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(1)}%`;
}

/**
 * A mark for display. `null` is "not entered", which must never render as `0` —
 * the difference between an unmarked paper and a zero is the difference between
 * an incomplete result and a failed one.
 */
export function formatMark(value: number | null | undefined, isAbsent: boolean) {
  if (isAbsent) return "AB";
  if (value === null || value === undefined) return "—";
  return String(Number(value));
}

/**
 * One typed cell on a mark sheet, understood.
 *
 * A mark register filled in by hand has three states in one column — a number,
 * a blank, and "AB" — and so does this. Making absence a *token* rather than a
 * second control is what lets a split paper have one narrow input per part
 * instead of an input and a checkbox per part, and it keeps the grid what the
 * design rules ask it to be: a column you can type down without reaching for
 * the mouse. `formatMark` already renders an absence as "AB", so what a teacher
 * types is what they see afterwards.
 */
export type MarkCell =
  | { kind: "empty" }
  | { kind: "absent" }
  | { kind: "value"; value: number }
  | { kind: "problem"; message: string };

const ABSENT_TOKENS = new Set(["a", "ab", "abs", "absent"]);

export function parseMarkCell(raw: string, maxMarks: number): MarkCell {
  const text = raw.trim();
  if (text === "") return { kind: "empty" };
  if (ABSENT_TOKENS.has(text.toLowerCase())) return { kind: "absent" };

  const value = Number(text);
  if (!Number.isFinite(value)) return { kind: "problem", message: "A mark, or AB for absent" };
  if (value < 0) return { kind: "problem", message: "Cannot be negative" };
  if (value > maxMarks) return { kind: "problem", message: `Above the maximum of ${maxMarks}` };
  return { kind: "value", value };
}

/** The message for a cell that cannot be saved, or null when it can. */
export function markProblem(raw: string, maxMarks: number): string | null {
  const cell = parseMarkCell(raw, maxMarks);
  return cell.kind === "problem" ? cell.message : null;
}

/** How full a mark sheet is, for the "12 of 40 entered" line. A row counts once
 *  every one of its cells has been resolved — which for a split paper means
 *  every part, because a paper with the practical still to mark is not marked. */
export function enteredCount(rows: { cells: string[] }[], maxima: number[]) {
  return rows.filter((row) =>
    row.cells.every((cell, i) => parseMarkCell(cell, maxima[i] ?? 0).kind !== "empty"),
  ).length;
}
