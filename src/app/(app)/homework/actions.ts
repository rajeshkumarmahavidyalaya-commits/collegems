"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  BUCKETS,
  formatBytes,
  removeFile,
  signedDownloadUrlFor,
  uploadFile,
  type BucketId,
} from "@/lib/storage/files";
import {
  gradeSchema,
  homeworkSchema,
  studyMaterialSchema,
  submitSchema,
} from "@/lib/validations/homework";
import type { ActionResult } from "../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

function invalid(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  return {
    ok: false as const,
    error: "Check the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

// ---------------------------------------------------------------------------
// The assignment
// ---------------------------------------------------------------------------

export type HomeworkRow = {
  id: string;
  title: string;
  instructions: string | null;
  sectionId: string;
  sectionLabel: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  assignedOn: string;
  dueOn: string;
  maxMarks: number | null;
  collectsSubmissions: boolean;
  status: string;
  publishedAt: string | null;
  attachmentCount: number;
  handedIn: number;
  marked: number;
  setCount: number;
};

export async function listHomework(sectionId?: string): Promise<HomeworkRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("homework")
    .select(
      "id, title, instructions, section_id, subject_id, assigned_on, due_on, max_marks, collects_submissions, status, published_at",
    )
    .order("due_on", { ascending: false });

  if (sectionId) query = query.eq("section_id", sectionId);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  if (!rows?.length) return [];

  const ids = rows.map((r) => r.id);

  // Four explicit queries rather than embeds: every one of these relationships
  // is a composite `(tenant_id, ...)` foreign key, which PostgREST has not been
  // verified to embed across from this project's test environment.
  const [sectionsRes, subjectsRes, submissionsRes, filesRes] = await Promise.all([
    supabase.from("sections").select("id, name, class_levels ( name, sequence )"),
    supabase.from("subjects").select("id, name, code"),
    supabase.from("homework_submissions").select("homework_id, status").in("homework_id", ids),
    supabase.from("homework_files").select("homework_id").in("homework_id", ids),
  ]);

  const sections = new Map(
    (sectionsRes.data ?? []).map((s) => [
      s.id,
      {
        label: s.class_levels ? `${s.class_levels.name} · ${s.name}` : s.name,
        sequence: s.class_levels?.sequence ?? 0,
      },
    ]),
  );
  const subjects = new Map((subjectsRes.data ?? []).map((s) => [s.id, s]));

  const tally = new Map<string, { set: number; handedIn: number; marked: number }>();
  for (const s of submissionsRes.data ?? []) {
    const row = tally.get(s.homework_id) ?? { set: 0, handedIn: 0, marked: 0 };
    row.set += 1;
    if (s.status !== "pending") row.handedIn += 1;
    if (s.status === "graded" || s.status === "returned") row.marked += 1;
    tally.set(s.homework_id, row);
  }

  const attachments = new Map<string, number>();
  for (const f of filesRes.data ?? []) {
    if (!f.homework_id) continue;
    attachments.set(f.homework_id, (attachments.get(f.homework_id) ?? 0) + 1);
  }

  return rows.map((r) => {
    const section = sections.get(r.section_id);
    const subject = subjects.get(r.subject_id);
    const counts = tally.get(r.id) ?? { set: 0, handedIn: 0, marked: 0 };
    return {
      id: r.id,
      title: r.title,
      instructions: r.instructions,
      sectionId: r.section_id,
      sectionLabel: section?.label ?? "Unknown class",
      subjectId: r.subject_id,
      subjectName: subject?.name ?? "Unknown subject",
      subjectCode: subject?.code ?? "",
      assignedOn: r.assigned_on,
      dueOn: r.due_on,
      maxMarks: r.max_marks === null ? null : Number(r.max_marks),
      collectsSubmissions: r.collects_submissions,
      status: r.status,
      publishedAt: r.published_at,
      attachmentCount: attachments.get(r.id) ?? 0,
      setCount: counts.set,
      handedIn: counts.handedIn,
      marked: counts.marked,
    };
  });
}

export async function getHomework(id: string): Promise<HomeworkRow | null> {
  const rows = await listHomework();
  return rows.find((r) => r.id === id) ?? null;
}

export async function saveHomework(
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = homeworkSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  if (!ctx.currentSessionId) return fail("This school has no current academic session.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    session_id: ctx.currentSessionId,
    section_id: parsed.data.sectionId,
    subject_id: parsed.data.subjectId,
    title: parsed.data.title,
    instructions: parsed.data.instructions || null,
    assigned_on: parsed.data.assignedOn,
    due_on: parsed.data.dueOn,
    max_marks: parsed.data.maxMarks.trim() === "" ? null : Number(parsed.data.maxMarks),
    collects_submissions: parsed.data.collectsSubmissions,
    assigned_by_staff_id: ctx.staffId,
  };

  const { data, error } = id
    ? await supabase.from("homework").update(payload).eq("id", id).select("id").single()
    : await supabase.from("homework").insert(payload).select("id").single();

  if (error) {
    if (error.code === "23503") {
      return fail(
        "That subject is not on this class's curriculum, so homework cannot be set for it. Assign it under Academics first.",
      );
    }
    if (error.code === "23514") {
      // The submissions' marks-within-maximum check firing through the FK's
      // `on update cascade`: the new maximum is below a mark already given.
      return fail(
        "A mark already given is above the new maximum, so the maximum cannot be lowered.",
      );
    }
    return fail(error.message);
  }

  revalidatePath("/homework");
  return { ok: true, data: { id: data.id } };
}

export async function publishHomework(id: string): Promise<ActionResult<{ created: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homework_publish", { p_homework_id: id });
  if (error) return fail(error.message);

  revalidatePath("/homework");
  revalidatePath(`/homework/${id}`);
  return { ok: true, data: { created: data ?? 0 } };
}

export async function unpublishHomework(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("homework_unpublish", { p_homework_id: id });
  if (error) return fail(error.message);

  revalidatePath("/homework");
  revalidatePath(`/homework/${id}`);
  return { ok: true, data: undefined };
}

export async function deleteHomework(id: string): Promise<ActionResult> {
  const supabase = await createClient();

  // The objects first, then the rows. `on delete cascade` will take the file
  // rows with the homework, and a row that has gone is a file nobody can ever
  // name again -- so the bucket has to be emptied while the paths are still
  // readable.
  const { data: files } = await supabase
    .from("homework_files")
    .select("bucket_id, storage_path")
    .eq("homework_id", id);

  for (const file of files ?? []) {
    await removeFile(file.bucket_id as BucketId, file.storage_path);
  }

  const { error } = await supabase.from("homework").delete().eq("id", id);
  if (error) return fail(error.message);

  revalidatePath("/homework");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// The marking sheet
// ---------------------------------------------------------------------------

export type SubmissionRow = {
  submissionId: string;
  studentId: string;
  admissionNumber: string;
  studentName: string;
  rollNumber: string | null;
  status: string;
  submittedAt: string | null;
  note: string | null;
  marksObtained: number | null;
  maxMarks: number | null;
  feedback: string | null;
  fileCount: number;
  isLate: boolean;
};

export async function getSubmissionSheet(homeworkId: string): Promise<SubmissionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homework_submission_sheet", {
    p_homework_id: homeworkId,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    submissionId: r.submission_id,
    studentId: r.student_id,
    admissionNumber: r.admission_number,
    studentName: r.student_name,
    rollNumber: r.roll_number,
    status: r.status,
    submittedAt: r.submitted_at,
    note: r.note,
    marksObtained: r.marks_obtained === null ? null : Number(r.marks_obtained),
    maxMarks: r.max_marks === null ? null : Number(r.max_marks),
    feedback: r.feedback,
    fileCount: r.file_count,
    isLate: r.is_late,
  }));
}

export async function gradeSubmission(input: unknown): Promise<ActionResult> {
  const parsed = gradeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("homework_grade", {
    p_submission_id: parsed.data.submissionId,
    // An empty box is feedback without a mark, which is a real thing a teacher
    // does -- "see me" on an unmarked exercise.
    p_marks: parsed.data.marks.trim() === "" ? undefined : Number(parsed.data.marks),
    p_feedback: parsed.data.feedback || undefined,
    p_return: true,
  });

  if (error) return fail(error.message);

  revalidatePath("/homework");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// What a family sees
// ---------------------------------------------------------------------------

export type StudentHomeworkRow = {
  homeworkId: string;
  submissionId: string | null;
  title: string;
  instructions: string | null;
  subjectName: string;
  subjectCode: string;
  sectionLabel: string;
  assignedOn: string;
  dueOn: string;
  collectsSubmissions: boolean;
  status: string;
  submittedAt: string | null;
  marksObtained: number | null;
  maxMarks: number | null;
  feedback: string | null;
  attachmentCount: number;
  submissionFileCount: number;
  isOverdue: boolean;
};

/**
 * `studentId` is optional and defaults, *inside the function*, to the caller's
 * own record -- so a student passes nothing and cannot point this at a
 * classmate. A parent passes one of their children's ids, and RLS on the
 * enrolment join is what decides whether that was one of theirs.
 */
export async function getStudentHomework(
  studentId?: string,
  includeDone = true,
): Promise<StudentHomeworkRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homework_for_student", {
    p_student_id: studentId || undefined,
    p_include_done: includeDone,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    homeworkId: r.homework_id,
    submissionId: r.submission_id,
    title: r.title,
    instructions: r.instructions,
    subjectName: r.subject_name,
    subjectCode: r.subject_code,
    sectionLabel: r.section_label,
    assignedOn: r.assigned_on,
    dueOn: r.due_on,
    collectsSubmissions: r.collects_submissions,
    status: r.status,
    submittedAt: r.submitted_at,
    marksObtained: r.marks_obtained === null ? null : Number(r.marks_obtained),
    maxMarks: r.max_marks === null ? null : Number(r.max_marks),
    feedback: r.feedback,
    attachmentCount: r.attachment_count,
    submissionFileCount: r.submission_file_count,
    isOverdue: r.is_overdue,
  }));
}

export async function submitHomework(input: unknown): Promise<ActionResult> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("homework_submit", {
    p_homework_id: parsed.data.homeworkId,
    p_note: parsed.data.note || undefined,
  });

  if (error) return fail(error.message);

  revalidatePath("/homework");
  return { ok: true, data: undefined };
}

export async function unsubmitHomework(homeworkId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("homework_unsubmit", { p_homework_id: homeworkId });
  if (error) return fail(error.message);

  revalidatePath("/homework");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export type FileRow = {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeLabel: string;
  bucketId: string;
  storagePath: string;
};

export async function listHomeworkFiles(
  owner: { homeworkId: string } | { submissionId: string },
): Promise<FileRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("homework_files")
    .select("id, file_name, content_type, size_bytes, bucket_id, storage_path")
    .order("created_at");

  query =
    "homeworkId" in owner
      ? query.eq("homework_id", owner.homeworkId)
      : query.eq("submission_id", owner.submissionId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((f) => ({
    id: f.id,
    fileName: f.file_name,
    contentType: f.content_type,
    sizeLabel: formatBytes(f.size_bytes),
    bucketId: f.bucket_id,
    storagePath: f.storage_path,
  }));
}

/**
 * Every attachment for a batch of homework and submissions at once, keyed by
 * the id it hangs off. One query rather than one per card: a class list of
 * thirty submissions would otherwise be thirty round trips to render a
 * paperclip.
 */
export async function listFilesByOwner(
  homeworkIds: string[],
  submissionIds: string[],
): Promise<Record<string, FileRow[]>> {
  if (homeworkIds.length === 0 && submissionIds.length === 0) return {};

  const supabase = await createClient();
  const filters: string[] = [];
  if (homeworkIds.length) filters.push(`homework_id.in.(${homeworkIds.join(",")})`);
  if (submissionIds.length) filters.push(`submission_id.in.(${submissionIds.join(",")})`);

  const { data, error } = await supabase
    .from("homework_files")
    .select("id, homework_id, submission_id, file_name, content_type, size_bytes, bucket_id, storage_path")
    .or(filters.join(","))
    .order("created_at");

  if (error) throw new Error(error.message);

  const byOwner: Record<string, FileRow[]> = {};
  for (const f of data ?? []) {
    const key = f.homework_id ?? f.submission_id;
    if (!key) continue;
    (byOwner[key] ??= []).push({
      id: f.id,
      fileName: f.file_name,
      contentType: f.content_type,
      sizeLabel: formatBytes(f.size_bytes),
      bucketId: f.bucket_id,
      storagePath: f.storage_path,
    });
  }
  return byOwner;
}

/**
 * Attach a file to a homework (the question sheet) or to a submission (the
 * answer). The row-level question -- may this caller write to this parent? --
 * is answered by RLS on `homework_files`, whose policy reaches the parent; the
 * insert simply fails if not. Storage's own rule is coarser and independent:
 * the object must sit under this tenant's prefix.
 *
 * The object goes up first and the row second, and a failed insert takes the
 * object back down: an orphaned row is a broken download on somebody's screen,
 * an orphaned object is a few bytes nobody sees.
 */
export async function attachFile(
  owner: { homeworkId: string } | { submissionId: string },
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a file to attach.");

  const bucket: BucketId =
    "homeworkId" in owner ? BUCKETS.studyMaterial : BUCKETS.homeworkSubmissions;
  const ownerId = "homeworkId" in owner ? owner.homeworkId : owner.submissionId;

  const uploaded = await uploadFile(bucket, ctx.tenantId, ownerId, file);
  if (!uploaded.ok) return fail(uploaded.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("homework_files")
    .insert({
      tenant_id: ctx.tenantId,
      homework_id: "homeworkId" in owner ? owner.homeworkId : null,
      submission_id: "submissionId" in owner ? owner.submissionId : null,
      bucket_id: bucket,
      storage_path: uploaded.path,
      file_name: uploaded.fileName,
      content_type: uploaded.contentType,
      size_bytes: uploaded.size,
      uploaded_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    await removeFile(bucket, uploaded.path);
    if (error.code === "42501") {
      return fail("You cannot attach a file to this piece of work.");
    }
    return fail(error.message);
  }

  revalidatePath("/homework");
  return { ok: true, data: { id: data.id } };
}

export async function detachFile(fileId: string): Promise<ActionResult> {
  const supabase = await createClient();

  // Read it back through RLS first: this both finds the path and answers
  // "may this person see the file at all", which is the same question as
  // "may they delete it" for everyone the write policy admits.
  const { data: file, error: readError } = await supabase
    .from("homework_files")
    .select("bucket_id, storage_path")
    .eq("id", fileId)
    .maybeSingle();

  if (readError) return fail(readError.message);
  if (!file) return fail("That file no longer exists.");

  const { error } = await supabase.from("homework_files").delete().eq("id", fileId);
  if (error) return fail(error.message);

  await removeFile(file.bucket_id as BucketId, file.storage_path);

  revalidatePath("/homework");
  return { ok: true, data: undefined };
}

/**
 * A signed URL for one attachment. The `select` is the permission check: if
 * RLS will not return the row to this caller, no signature is issued. This is
 * the shape rule 8 asks for -- never a public URL, and never a signature handed
 * out before `public` has been asked.
 */
export async function downloadUrlFor(fileId: string): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const { data: file } = await supabase
    .from("homework_files")
    .select("bucket_id, storage_path, file_name")
    .eq("id", fileId)
    .maybeSingle();

  if (!file) return fail("That file is not available to you.");

  const url = await signedDownloadUrlFor(
    file.bucket_id as BucketId,
    file.storage_path,
    file.file_name,
  );
  if (!url) return fail("That file could not be opened. It may have been removed.");

  return { ok: true, data: { url } };
}

// ---------------------------------------------------------------------------
// Study material
// ---------------------------------------------------------------------------

export type StudyMaterialRow = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  sectionId: string | null;
  sectionLabel: string;
  subjectId: string | null;
  subjectName: string;
  fileName: string | null;
  sizeLabel: string;
  externalUrl: string | null;
  isPublished: boolean;
  createdAt: string;
};

export async function listStudyMaterial(): Promise<StudyMaterialRow[]> {
  const supabase = await createClient();

  const [materialRes, sectionsRes, subjectsRes] = await Promise.all([
    supabase
      .from("study_material")
      .select(
        "id, title, description, kind, section_id, subject_id, file_name, size_bytes, external_url, is_published, created_at",
      )
      .order("created_at", { ascending: false }),
    supabase.from("sections").select("id, name, class_levels ( name )"),
    supabase.from("subjects").select("id, name"),
  ]);

  if (materialRes.error) throw new Error(materialRes.error.message);

  const sections = new Map(
    (sectionsRes.data ?? []).map((s) => [
      s.id,
      s.class_levels ? `${s.class_levels.name} · ${s.name}` : s.name,
    ]),
  );
  const subjects = new Map((subjectsRes.data ?? []).map((s) => [s.id, s.name]));

  return (materialRes.data ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    kind: m.kind,
    sectionId: m.section_id,
    // A null section is "the whole school" and a null subject is "general".
    // Both are answers, so neither renders as a blank cell.
    sectionLabel: m.section_id ? (sections.get(m.section_id) ?? "Unknown class") : "Whole school",
    subjectId: m.subject_id,
    subjectName: m.subject_id ? (subjects.get(m.subject_id) ?? "Unknown subject") : "General",
    fileName: m.file_name,
    sizeLabel: formatBytes(m.size_bytes),
    externalUrl: m.external_url,
    isPublished: m.is_published,
    createdAt: m.created_at,
  }));
}

export async function saveStudyMaterial(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const parsed = studyMaterialSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    kind: String(formData.get("kind") ?? "document"),
    sectionId: String(formData.get("sectionId") ?? ""),
    subjectId: String(formData.get("subjectId") ?? ""),
    externalUrl: String(formData.get("externalUrl") ?? ""),
    isPublished: formData.get("isPublished") === "on" || formData.get("isPublished") === "true",
  });
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  if (!ctx.currentSessionId) return fail("This school has no current academic session.");

  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;

  // The half of `study_material_source_chk` the schema cannot see. Saying it
  // here means a person gets a sentence about the field they left empty rather
  // than a constraint name.
  if (parsed.data.kind === "document" && !hasFile) {
    return {
      ok: false,
      error: "Choose a file to upload, or change the kind to a link.",
      fieldErrors: { file: ["A file is required"] },
    };
  }
  if (parsed.data.kind !== "document" && hasFile) {
    return fail("A link cannot also carry a file. Change the kind to a file, or remove it.");
  }

  const supabase = await createClient();
  let uploadedPath: string | null = null;
  let uploadedName: string | null = null;
  let uploadedType: string | null = null;
  let uploadedSize: number | null = null;

  if (hasFile) {
    const uploaded = await uploadFile(
      BUCKETS.studyMaterial,
      ctx.tenantId,
      ctx.staffId ?? ctx.userId,
      file,
    );
    if (!uploaded.ok) return fail(uploaded.error);
    uploadedPath = uploaded.path;
    uploadedName = uploaded.fileName;
    uploadedType = uploaded.contentType;
    uploadedSize = uploaded.size;
  }

  const { data, error } = await supabase
    .from("study_material")
    .insert({
      tenant_id: ctx.tenantId,
      session_id: ctx.currentSessionId,
      section_id: parsed.data.sectionId || null,
      subject_id: parsed.data.subjectId || null,
      title: parsed.data.title,
      description: parsed.data.description || null,
      kind: parsed.data.kind,
      storage_path: uploadedPath,
      bucket_id: uploadedPath ? BUCKETS.studyMaterial : null,
      file_name: uploadedName,
      content_type: uploadedType,
      size_bytes: uploadedSize,
      external_url: parsed.data.externalUrl || null,
      is_published: parsed.data.isPublished,
      uploaded_by_staff_id: ctx.staffId,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (uploadedPath) await removeFile(BUCKETS.studyMaterial, uploadedPath);
    return fail(error.message);
  }

  revalidatePath("/study-material");
  return { ok: true, data: { id: data.id } };
}

export async function setMaterialPublished(
  id: string,
  isPublished: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("study_material")
    .update({ is_published: isPublished })
    .eq("id", id);

  if (error) return fail(error.message);

  revalidatePath("/study-material");
  return { ok: true, data: undefined };
}

export async function deleteStudyMaterial(id: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: material } = await supabase
    .from("study_material")
    .select("bucket_id, storage_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("study_material").delete().eq("id", id);
  if (error) return fail(error.message);

  if (material?.storage_path && material.bucket_id) {
    await removeFile(material.bucket_id as BucketId, material.storage_path);
  }

  revalidatePath("/study-material");
  return { ok: true, data: undefined };
}

export async function materialDownloadUrl(id: string): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const { data: material } = await supabase
    .from("study_material")
    .select("bucket_id, storage_path, file_name")
    .eq("id", id)
    .maybeSingle();

  if (!material?.storage_path || !material.bucket_id) {
    return fail("That item is not available to you.");
  }

  const url = await signedDownloadUrlFor(
    material.bucket_id as BucketId,
    material.storage_path,
    material.file_name ?? "download",
  );
  if (!url) return fail("That file could not be opened. It may have been removed.");

  return { ok: true, data: { url } };
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

export type CurriculumOption = {
  sectionId: string;
  sectionLabel: string;
  subjectId: string;
  subjectName: string;
};

/**
 * Every (class, subject) pair the signed-in person may set homework for. It is
 * read from `section_subjects` rather than from `sections` x `subjects`,
 * because the composite foreign key on `homework` will refuse any other pair --
 * so offering one would be offering a choice that cannot be saved.
 */
export async function listCurriculum(): Promise<CurriculumOption[]> {
  const supabase = await createClient();

  const { data: assignments, error } = await supabase
    .from("section_subjects")
    .select("section_id, subject_id");

  if (error) throw new Error(error.message);
  if (!assignments?.length) return [];

  const [sectionsRes, subjectsRes] = await Promise.all([
    supabase.from("sections").select("id, name, class_levels ( name, sequence )"),
    supabase.from("subjects").select("id, name").eq("is_active", true),
  ]);

  const sections = new Map(
    (sectionsRes.data ?? []).map((s) => [
      s.id,
      {
        label: s.class_levels ? `${s.class_levels.name} · ${s.name}` : s.name,
        sequence: s.class_levels?.sequence ?? 0,
      },
    ]),
  );
  const subjects = new Map((subjectsRes.data ?? []).map((s) => [s.id, s.name]));

  return assignments
    .filter((a) => sections.has(a.section_id) && subjects.has(a.subject_id))
    .map((a) => ({
      sectionId: a.section_id,
      sectionLabel: sections.get(a.section_id)!.label,
      sequence: sections.get(a.section_id)!.sequence,
      subjectId: a.subject_id,
      subjectName: subjects.get(a.subject_id)!,
    }))
    .sort(
      (a, b) =>
        a.sequence - b.sequence ||
        a.sectionLabel.localeCompare(b.sectionLabel) ||
        a.subjectName.localeCompare(b.subjectName),
    )
    .map(({ sequence, ...rest }) => {
      void sequence;
      return rest;
    });
}

export async function listChildren(): Promise<
  { id: string; name: string; sectionLabel: string }[]
> {
  const ctx = await getUserContext();
  if (!ctx?.guardianId) return [];

  const supabase = await createClient();
  const { data: links } = await supabase
    .from("guardian_student")
    .select("student_id")
    .eq("guardian_id", ctx.guardianId);

  if (!links?.length) return [];
  const ids = links.map((l) => l.student_id);

  const [studentsRes, enrolmentsRes, sectionsRes] = await Promise.all([
    supabase.from("students").select("id, people:person_id ( first_name, last_name )").in("id", ids),
    supabase
      .from("enrolments")
      .select("student_id, section_id")
      .in("student_id", ids)
      .eq("status", "active"),
    supabase.from("sections").select("id, name, class_levels ( name )"),
  ]);

  const sections = new Map(
    (sectionsRes.data ?? []).map((s) => [
      s.id,
      s.class_levels ? `${s.class_levels.name} · ${s.name}` : s.name,
    ]),
  );
  const sectionFor = new Map((enrolmentsRes.data ?? []).map((e) => [e.student_id, e.section_id]));

  return (studentsRes.data ?? []).map((s) => {
    const sectionId = sectionFor.get(s.id);
    return {
      id: s.id,
      name: s.people ? `${s.people.first_name} ${s.people.last_name}` : "Unnamed",
      sectionLabel: sectionId ? (sections.get(sectionId) ?? "—") : "Not enrolled",
    };
  });
}
