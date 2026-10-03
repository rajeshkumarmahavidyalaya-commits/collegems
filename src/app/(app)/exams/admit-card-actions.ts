"use server";

import { createClient } from "@/lib/supabase/server";

export type AdmitCardPaper = {
  examSubjectId: string;
  subject: string;
  code: string | null;
  date: string | null;
  startsAt: string | null;
  endsAt: string | null;
  slot: string | null;
  maxMarks: number;
  room: string | null;
  seatNo: number | null;
};

export type AdmitCard = {
  studentId: string;
  admissionNumber: string;
  fullName: string;
  rollNumber: string | null;
  dateOfBirth: string | null;
  className: string | null;
  sectionName: string | null;
  papers: AdmitCardPaper[];
};

type RawPaper = {
  exam_subject_id: string;
  subject: string;
  code: string | null;
  date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  slot: string | null;
  max_marks: number | string;
  room: string | null;
  seat_no: number | null;
};

/**
 * One class's admit cards (0322). `exams_admit_cards` is INVOKER and refuses
 * without `exams.manage` in a sentence, which comes back here as the error --
 * never as an empty class, which would read like a class with no papers.
 */
export async function getAdmitCards(
  examId: string,
  sectionId: string,
): Promise<{ ok: true; cards: AdmitCard[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exams_admit_cards", { p_exam_id: examId, p_section_id: sectionId });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    cards: (data ?? []).map((r) => ({
      studentId: r.student_id,
      admissionNumber: r.admission_number,
      fullName: r.full_name,
      rollNumber: r.roll_number,
      dateOfBirth: r.date_of_birth,
      className: r.class_name,
      sectionName: r.section_name,
      papers: ((r.papers ?? []) as unknown as RawPaper[]).map((p) => ({
        examSubjectId: p.exam_subject_id,
        subject: p.subject,
        code: p.code,
        date: p.date,
        startsAt: p.starts_at,
        endsAt: p.ends_at,
        slot: p.slot,
        maxMarks: Number(p.max_marks),
        room: p.room,
        seatNo: p.seat_no,
      })),
    })),
  };
}
