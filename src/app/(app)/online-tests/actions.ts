"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  answersSchema,
  createTestSchema,
  questionSchema,
} from "@/lib/validations/online-tests";
import type { ActionResult } from "../library/actions";

/**
 * Online tests (migration 0274). Nothing in this file is a gate: the list and
 * the test rows are RLS's, every write is a function that checks for itself,
 * and a student reaches the questions only through `online_test_start` -- the
 * table itself has no policy a student matches, because the answer key is a
 * column of the question row.
 */

export type TestRow = {
  id: string;
  title: string;
  status: "draft" | "published";
  opensAt: string;
  closesAt: string;
  durationMinutes: number;
  revealAnswers: boolean;
  classLabel: string;
  subjectName: string;
  timezone: string;
  questionCount: number;
  totalMarks: number;
  sittings: number;
  submitted: number;
};

export type Course = { value: string; label: string; sessionName: string };

export type Question = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  correctOption: number;
  marks: number;
};

export type Sitting = {
  testId: string;
  studentId: string;
  startedAt: string;
  dueAt: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
  submittedLate: boolean;
};

export type Paper = {
  test: { id: string; title: string; instructions: string | null; closesAt: string; durationMinutes: number; revealAnswers: boolean };
  attempt: { startedAt: string; dueAt: string; savedAt: string | null; submittedAt: string | null; score: number | null; maxScore: number | null; submittedLate: boolean };
  answers: Record<string, number>;
  questions: { id: string; position: number; prompt: string; options: string[]; marks: number }[];
};

export type ReviewedQuestion = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  marks: number;
  correctOption: number;
  chosen: number | null;
};

export type ResultRow = {
  studentId: string;
  admissionNumber: string;
  name: string;
  state: "not_started" | "in_progress" | "submitted" | "lapsed";
  submittedAt: string | null;
  submittedLate: boolean;
  score: number | null;
  maxScore: number | null;
  provisional: boolean;
};

export type QuestionStat = { id: string; position: number; prompt: string; answered: number; correct: number };

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ---------------------------------------------------------------- reads --

export async function listTests(): Promise<TestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("online_tests_list");
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status as TestRow["status"],
    opensAt: t.opens_at,
    closesAt: t.closes_at,
    durationMinutes: t.duration_minutes,
    revealAnswers: t.reveal_answers,
    classLabel: t.class_label,
    subjectName: t.subject_name,
    timezone: t.timezone,
    questionCount: t.question_count,
    totalMarks: Number(t.total_marks),
    sittings: t.sittings,
    submitted: t.submitted,
  }));
}

/**
 * A lookup by primary key, deliberately not `listTests().find(...)`: the list
 * is windowed to the last 120 days and a lookup is not a list (rule 2) -- an
 * older test's page must still open. RLS decides whether the caller may have
 * the row; the counts come through the same policies.
 */
export async function getTest(id: string): Promise<(TestRow & { course: string }) | null> {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data: t } = await supabase
    .from("online_tests")
    .select("id, title, status, opens_at, closes_at, duration_minutes, reveal_answers, section_id, subject_id")
    .eq("id", id)
    .maybeSingle();
  if (!t) return null;

  const [section, subject, tenant, questions, sittings] = await Promise.all([
    supabase.from("sections").select("name, class_levels ( name )").eq("id", t.section_id).maybeSingle(),
    supabase.from("subjects").select("name").eq("id", t.subject_id).maybeSingle(),
    supabase.from("tenants").select("timezone").maybeSingle(),
    supabase.from("online_test_questions").select("marks").eq("test_id", id),
    supabase.from("online_test_attempts").select("submitted_at").eq("test_id", id),
  ]);

  const level = section.data?.class_levels as { name: string } | null | undefined;
  return {
    id: t.id,
    title: t.title,
    status: t.status as TestRow["status"],
    opensAt: t.opens_at,
    closesAt: t.closes_at,
    durationMinutes: t.duration_minutes,
    revealAnswers: t.reveal_answers,
    classLabel: [level?.name, section.data?.name].filter(Boolean).join(" "),
    subjectName: subject.data?.name ?? "",
    timezone: tenant.data?.timezone ?? "Asia/Kolkata",
    questionCount: questions.data?.length ?? 0,
    totalMarks: (questions.data ?? []).reduce((sum, q) => sum + Number(q.marks), 0),
    sittings: sittings.data?.length ?? 0,
    submitted: (sittings.data ?? []).filter((a) => a.submitted_at).length,
    // The key `teaching_courses()` answers in, so the page can ask whether the
    // caller is this test's own teacher rather than somebody who may only read it.
    course: `${t.section_id}:${t.subject_id}`,
  };
}

/** `teaching_courses()`: the write policies' own predicate, so the dialog cannot offer a class the insert would refuse. */
export async function listCourses(): Promise<Course[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("teaching_courses");
  if (error || !data) return [];
  return data.map((c) => ({
    value: `${c.section_id}:${c.subject_id}`,
    label: c.label.replace(" -- ", " · "),
    sessionName: c.session_name,
  }));
}

/** The questions with their key -- through RLS, so only the test's own teacher or an administrator gets rows. */
export async function listQuestions(testId: string): Promise<Question[]> {
  if (!isUuid(testId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("online_test_questions")
    .select("id, position, prompt, options, correct_option, marks")
    .eq("test_id", testId)
    .order("position")
    .order("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((q) => ({
    id: q.id,
    position: q.position,
    prompt: q.prompt,
    options: (q.options as string[]) ?? [],
    correctOption: q.correct_option,
    marks: Number(q.marks),
  }));
}

/** The caller's own sittings, or their children's -- the attempts policies decide which. */
export async function listSittings(): Promise<Sitting[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("online_test_attempts")
    .select("test_id, student_id, started_at, due_at, submitted_at, score, max_score, submitted_late")
    .order("started_at", { ascending: false })
    .order("id")
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({
    testId: a.test_id,
    studentId: a.student_id,
    startedAt: a.started_at,
    dueAt: a.due_at,
    submittedAt: a.submitted_at,
    score: a.score == null ? null : Number(a.score),
    maxScore: a.max_score == null ? null : Number(a.max_score),
    submittedLate: a.submitted_late,
  }));
}

export async function getResults(
  testId: string,
): Promise<{ rows: ResultRow[]; questions: QuestionStat[] } | { error: string }> {
  if (!isUuid(testId)) return { error: "That is not a test." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("online_test_results", { p_test_id: testId });
  if (error) return { error: error.message };
  const doc = data as {
    rows: {
      student_id: string;
      admission_number: string;
      name: string;
      state: ResultRow["state"];
      submitted_at: string | null;
      submitted_late: boolean;
      score: number | null;
      max_score: number | null;
      provisional: boolean;
    }[];
    questions: { id: string; position: number; prompt: string; answered: number; correct: number }[];
  };
  return {
    rows: doc.rows.map((r) => ({
      studentId: r.student_id,
      admissionNumber: r.admission_number,
      name: r.name,
      state: r.state,
      submittedAt: r.submitted_at,
      submittedLate: r.submitted_late,
      score: r.score == null ? null : Number(r.score),
      maxScore: r.max_score == null ? null : Number(r.max_score),
      provisional: r.provisional,
    })),
    questions: doc.questions,
  };
}

// ------------------------------------------------------ the teacher's half --

export async function createTest(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = createTestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const v = parsed.data;
  const [sectionId, subjectId] = v.course.split(":");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("online_test_create", {
    p_test: {
      section_id: sectionId,
      subject_id: subjectId,
      title: v.title,
      instructions: v.instructions,
      opens_on: v.opensOn,
      opens_at: v.opensAt,
      closes_on: v.closesOn,
      closes_at: v.closesAt,
      minutes: Number(v.minutes),
      reveal_answers: v.reveal === "after_close",
    },
  });
  if (error) return fail(error.message);
  revalidatePath("/online-tests");
  return { ok: true, data: { id: data as string } };
}

export async function saveQuestion(testId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!isUuid(testId)) return fail("That is not a test.");
  const parsed = questionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the question.");
  const q = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("online_test_save_question", {
    p_test_id: testId,
    p_question: {
      id: q.id ?? "",
      prompt: q.prompt,
      options: q.options,
      correct_option: q.correctOption,
      marks: q.marks,
    },
  });
  if (error) return fail(error.message);
  revalidatePath(`/online-tests/${testId}`);
  return { ok: true, data: { id: data as string } };
}

async function call(
  fn: "online_test_delete_question" | "online_test_publish" | "online_test_unpublish" | "online_test_delete",
  id: string,
  path: string,
): Promise<ActionResult> {
  if (!isUuid(id)) return fail("That is not one you can change.");
  const supabase = await createClient();
  const { error } =
    fn === "online_test_delete_question"
      ? await supabase.rpc(fn, { p_question_id: id })
      : await supabase.rpc(fn, { p_test_id: id });
  if (error) return fail(error.message);
  revalidatePath(path);
  return { ok: true, data: undefined };
}

export async function deleteQuestion(testId: string, questionId: string): Promise<ActionResult> {
  return call("online_test_delete_question", questionId, `/online-tests/${testId}`);
}

export async function publishTest(testId: string): Promise<ActionResult> {
  return call("online_test_publish", testId, `/online-tests/${testId}`);
}

export async function unpublishTest(testId: string): Promise<ActionResult> {
  return call("online_test_unpublish", testId, `/online-tests/${testId}`);
}

export async function deleteTest(testId: string): Promise<ActionResult> {
  return call("online_test_delete", testId, "/online-tests");
}

// ------------------------------------------------------ the student's half --

function toPaper(doc: {
  test: { id: string; title: string; instructions: string | null; closes_at: string; duration_minutes: number; reveal_answers: boolean };
  attempt: { started_at: string; due_at: string; saved_at: string | null; submitted_at: string | null; score: number | null; max_score: number | null; submitted_late: boolean };
  answers: Record<string, number>;
  questions: { id: string; position: number; prompt: string; options: string[]; marks: number }[];
}): Paper {
  return {
    test: {
      id: doc.test.id,
      title: doc.test.title,
      instructions: doc.test.instructions,
      closesAt: doc.test.closes_at,
      durationMinutes: doc.test.duration_minutes,
      revealAnswers: doc.test.reveal_answers,
    },
    attempt: {
      startedAt: doc.attempt.started_at,
      dueAt: doc.attempt.due_at,
      savedAt: doc.attempt.saved_at,
      submittedAt: doc.attempt.submitted_at,
      score: doc.attempt.score == null ? null : Number(doc.attempt.score),
      maxScore: doc.attempt.max_score == null ? null : Number(doc.attempt.max_score),
      submittedLate: doc.attempt.submitted_late,
    },
    answers: doc.answers ?? {},
    questions: doc.questions.map((q) => ({ ...q, marks: Number(q.marks) })),
  };
}

/** Starts the clock the first time; afterwards reopens the same sitting. */
export async function startTest(testId: string): Promise<ActionResult<Paper>> {
  if (!isUuid(testId)) return fail("That is not a test.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("online_test_start", { p_test_id: testId });
  if (error) return fail(error.message);
  return { ok: true, data: toPaper(data as Parameters<typeof toPaper>[0]) };
}

export async function saveAnswers(testId: string, answers: unknown): Promise<ActionResult<{ savedAt: string }>> {
  if (!isUuid(testId)) return fail("That is not a test.");
  const parsed = answersSchema.safeParse(answers);
  if (!parsed.success) return fail("Those answers are not ones this test understands.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("online_test_save", { p_test_id: testId, p_answers: parsed.data });
  if (error) return fail(error.message);
  return { ok: true, data: { savedAt: (data as { saved_at: string }).saved_at } };
}

export async function submitTest(
  testId: string,
  answers: unknown,
): Promise<ActionResult<{ score: number; maxScore: number; submittedLate: boolean }>> {
  if (!isUuid(testId)) return fail("That is not a test.");
  const parsed = answersSchema.safeParse(answers);
  if (!parsed.success) return fail("Those answers are not ones this test understands.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("online_test_submit", { p_test_id: testId, p_answers: parsed.data });
  if (error) return fail(error.message);
  const r = data as { score: number; max_score: number; submitted_late: boolean };
  revalidatePath("/online-tests");
  return { ok: true, data: { score: Number(r.score), maxScore: Number(r.max_score), submittedLate: r.submitted_late } };
}

export async function reviewTest(
  testId: string,
): Promise<ActionResult<{ score: number | null; maxScore: number | null; questions: ReviewedQuestion[] }>> {
  if (!isUuid(testId)) return fail("That is not a test.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("online_test_review", { p_test_id: testId });
  if (error) return fail(error.message);
  const doc = data as {
    score: number | null;
    max_score: number | null;
    questions: { id: string; position: number; prompt: string; options: string[]; marks: number; correct_option: number; chosen: number | null }[];
  };
  return {
    ok: true,
    data: {
      score: doc.score == null ? null : Number(doc.score),
      maxScore: doc.max_score == null ? null : Number(doc.max_score),
      questions: doc.questions.map((q) => ({
        id: q.id,
        position: q.position,
        prompt: q.prompt,
        options: q.options,
        marks: Number(q.marks),
        correctOption: q.correct_option,
        chosen: q.chosen,
      })),
    },
  };
}
