import { z } from "zod";
import { OPTIONS_MAX, OPTIONS_MIN } from "./online-tests-display";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const time = z.string().regex(/^\d{2}:\d{2}$/, "Choose a time.");

/** The dialog that sets a test. The database repeats every rule; this is the courtesy. */
export const createTestSchema = z.object({
  course: z.string().regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/, "Choose a class and subject."),
  title: z.string().trim().min(1, "Give the test a title.").max(120, "At most 120 characters."),
  instructions: z.string().trim().max(2000, "At most 2,000 characters."),
  opensOn: date,
  opensAt: time,
  closesOn: date,
  closesAt: time,
  minutes: z
    .string()
    .regex(/^\d{1,3}$/, "Minutes, as a number.")
    .refine((v) => Number(v) >= 5 && Number(v) <= 300, "Between 5 and 300 minutes."),
  // After the test closes for everybody, or never. Never before: the class is
  // still sitting it, and the database refuses it anyway.
  reveal: z.enum(["after_close", "never"]),
});

export type CreateTestInput = z.infer<typeof createTestSchema>;

export const questionSchema = z
  .object({
    id: z.string().uuid().optional(),
    prompt: z.string().trim().min(1, "Write the question.").max(2000, "At most 2,000 characters."),
    options: z
      .array(z.string().trim().max(300, "Keep each option under 300 characters."))
      .transform((o) => o.filter((x) => x !== ""))
      .refine((o) => o.length >= OPTIONS_MIN && o.length <= OPTIONS_MAX, {
        message: `Give between ${OPTIONS_MIN} and ${OPTIONS_MAX} options.`,
      }),
    correctOption: z.number().int().min(0, "Choose the right answer."),
    marks: z.number().positive("More than 0 marks.").max(100, "At most 100 marks."),
  })
  .refine((q) => q.correctOption < q.options.length, {
    message: "Choose which option is the right answer.",
    path: ["correctOption"],
  });

export type QuestionInput = z.input<typeof questionSchema>;

/** Answers as the paper holds them: question id to the chosen option's index. */
export const answersSchema = z.record(z.string().uuid(), z.number().int().min(0).max(5));
