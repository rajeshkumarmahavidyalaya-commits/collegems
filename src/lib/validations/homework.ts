import { z } from "zod";

// Everything that is not a schema lives in `homework-display.ts` (no Zod).
export * from "./homework-display";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

/**
 * `maxMarks` is a string for the same reason a mark is on the exam sheet: an
 * empty box means "this homework is not marked out of anything", which is a
 * different fact from zero, and `z.coerce` would collapse the two as well as
 * splitting the input/output types and breaking the resolver.
 */
export const homeworkSchema = z
  .object({
    sectionId: z.string().uuid("Choose a class"),
    subjectId: z.string().uuid("Choose a subject"),
    title: z.string().min(1, "Give the homework a title").max(200),
    instructions: z.string().max(4000).optional(),
    assignedOn: isoDate,
    dueOn: isoDate,
    maxMarks: z.string(),
    collectsSubmissions: z.boolean(),
  })
  .refine((v) => v.dueOn >= v.assignedOn, {
    message: "The due date cannot be before the day it was set",
    path: ["dueOn"],
  })
  .refine((v) => v.maxMarks.trim() === "" || Number(v.maxMarks) > 0, {
    message: "A maximum must be above zero, or left blank",
    path: ["maxMarks"],
  })
  .refine(
    (v) => v.maxMarks.trim() === "" || Number.isFinite(Number(v.maxMarks)),
    {
      message: "That is not a number",
      path: ["maxMarks"],
    },
  )
  // Marking work nobody hands in is a screen with nothing on it. Caught here
  // rather than in Postgres because it is advice, not corruption.
  .refine((v) => v.collectsSubmissions || v.maxMarks.trim() === "", {
    message: "Homework that is not collected cannot be marked out of anything",
    path: ["maxMarks"],
  });

export type HomeworkInput = z.infer<typeof homeworkSchema>;

export const submitSchema = z.object({
  homeworkId: z.string().uuid(),
  note: z.string().max(1000).optional(),
});

export type SubmitInput = z.infer<typeof submitSchema>;

export const gradeSchema = z.object({
  submissionId: z.string().uuid(),
  marks: z.string(),
  feedback: z.string().max(2000).optional(),
});

export type GradeInput = z.infer<typeof gradeSchema>;

export const studyMaterialSchema = z
  .object({
    title: z.string().min(1, "Give the material a title").max(200),
    description: z.string().max(2000).optional(),
    kind: z.enum(["document", "video", "link"]),
    // Empty string is "the whole school" / "general", which are real answers
    // rather than missing ones — see the nullable columns on `study_material`.
    sectionId: z.union([z.string().uuid(), z.literal("")]).optional(),
    subjectId: z.union([z.string().uuid(), z.literal("")]).optional(),
    externalUrl: z
      .union([z.string().url("That is not a web address"), z.literal("")])
      .optional(),
    isPublished: z.boolean(),
  })
  // Mirrors `study_material_source_chk`: a file or a link, never both and never
  // neither. The file half cannot be seen from here — it is a `File` on the
  // FormData — so the action completes the check with what it can see.
  .refine((v) => v.kind === "document" || (v.externalUrl ?? "") !== "", {
    message: "A video or a link needs a web address",
    path: ["externalUrl"],
  });

export type StudyMaterialInput = z.infer<typeof studyMaterialSchema>;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
