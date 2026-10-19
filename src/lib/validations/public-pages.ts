/**
 * What a college's public pages read and send (migration 0361).
 *
 * Every page under `/college/[slug]` reads jsonb from a function anybody can
 * call, so each shape is read defensively here: a key missing or of the wrong
 * type becomes the closed page or an empty value, never a stack trace. The
 * readers live in a module with no runtime imports so a test can pin them
 * without a database, and so a client component importing one ships nothing
 * else (the `admissions-display.ts` rule).
 *
 * `ENQUIRY_KEYS` and `STAFF_APPLICATION_KEYS` are the keys the actions send.
 * `tests/public/public-pages.test.ts` checks them against what
 * `public_enquiry` and `public_staff_apply` read, in both directions, so a
 * field typed in the form is never silently dropped by the function.
 */

export type PublicPage =
  | "apply"
  | "enquiry"
  | "staff_application"
  | "certificate_check"
  | "exam_timetable"
  | "admit_cards"
  | "results";

export const PUBLIC_PAGES: readonly PublicPage[] = [
  "apply",
  "enquiry",
  "staff_application",
  "certificate_check",
  "exam_timetable",
  "admit_cards",
  "results",
];

export type PublicCollege = {
  college: string;
  slug: string;
  session: string | null;
  note: string | null;
  pages: Record<PublicPage, boolean>;
  classLevels: { id: string; name: string }[];
  /** The exams an admit card can be looked up for; empty unless admit cards are on (0363). */
  admitExams: { id: string; name: string }[];
};

export const ENQUIRY_KEYS = ["student_name", "contact_name", "phone", "email", "class_level_id", "message"] as const;

export const STAFF_APPLICATION_KEYS = [
  "first_name",
  "last_name",
  "date_of_birth",
  "gender",
  "email",
  "phone",
  "city",
  "position",
  "qualification",
  "experience_years",
  "message",
] as const;

/** The bounds the two write functions enforce, for `maxLength` and the action's own check. */
export const PUBLIC_LIMITS = {
  studentName: 160,
  contactName: 120,
  name: 80,
  email: 200,
  phone: 20,
  city: 100,
  position: 100,
  qualification: 300,
  enquiryMessage: 1000,
  jobMessage: 2000,
  lookup: 60,
} as const;

export const PHONE_PATTERN = /^[0-9+() -]{6,20}$/;
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const EXPERIENCE_PATTERN = /^\d{1,2}(\.\d)?$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function list(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.flatMap((x) => (obj(x) ? [x as Record<string, unknown>] : [])) : [];
}

export function readCollege(data: unknown): PublicCollege | null {
  const d = obj(data);
  if (!d || typeof d.college !== "string" || typeof d.slug !== "string") return null;
  const p = obj(d.pages) ?? {};
  const pages = Object.fromEntries(PUBLIC_PAGES.map((k) => [k, p[k] === true])) as Record<PublicPage, boolean>;
  return {
    college: d.college,
    slug: d.slug,
    session: str(d.session),
    note: str(d.note),
    pages,
    classLevels: list(d.class_levels).flatMap((l) =>
      typeof l.id === "string" ? [{ id: l.id, name: String(l.name ?? "") }] : [],
    ),
    admitExams: list(d.admit_exams).flatMap((e) =>
      typeof e.id === "string" ? [{ id: e.id, name: String(e.name ?? "") }] : [],
    ),
  };
}

export type TimetablePaper = {
  className: string;
  subject: string;
  date: string | null;
  startsAt: string | null;
  endsAt: string | null;
};
export type TimetableExam = {
  id: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  centre: string | null;
  papers: TimetablePaper[];
};

export function readTimetable(data: unknown): TimetableExam[] | null {
  const d = obj(data);
  if (!d) return null;
  return list(d.exams).flatMap((e) =>
    typeof e.id === "string"
      ? [
          {
            id: e.id,
            name: String(e.name ?? ""),
            startsOn: str(e.starts_on),
            endsOn: str(e.ends_on),
            centre: str(e.centre),
            papers: list(e.papers).map((p) => ({
              className: String(p.class ?? ""),
              subject: String(p.subject ?? ""),
              date: str(p.date),
              startsAt: str(p.starts_at),
              endsAt: str(p.ends_at),
            })),
          },
        ]
      : [],
  );
}

export type AdmitCard = {
  exam: string;
  centre: string | null;
  student: string;
  admissionNumber: string;
  className: string;
  rollNumber: string | null;
  papers: (TimetablePaper & { room: string | null; seat: number | null })[];
};

export function readAdmitCard(data: unknown): AdmitCard | null {
  const d = obj(data);
  if (!d || typeof d.exam !== "string" || typeof d.student !== "string") return null;
  return {
    exam: d.exam,
    centre: str(d.centre),
    student: d.student,
    admissionNumber: String(d.admission_number ?? ""),
    className: String(d.class ?? ""),
    rollNumber: str(d.roll_number),
    papers: list(d.papers).map((p) => ({
      className: String(d.class ?? ""),
      subject: String(p.subject ?? ""),
      date: str(p.date),
      startsAt: str(p.starts_at),
      endsAt: str(p.ends_at),
      room: str(p.room),
      seat: num(p.seat),
    })),
  };
}

export type ResultSubject = {
  subject: string;
  obtained: number | null;
  max: number | null;
  passed: boolean | null;
  absent: boolean;
};
export type PublicResult = {
  exam: string;
  session: string | null;
  publishedOn: string | null;
  total: number | null;
  max: number | null;
  percentage: number | null;
  grade: string | null;
  result: string | null;
  rank: number | null;
  cohort: number | null;
  subjects: ResultSubject[];
};

export function readResults(data: unknown): { student: string; results: PublicResult[] } | null {
  const d = obj(data);
  if (!d || typeof d.student !== "string") return null;
  const results = list(d.results).map((r) => ({
    exam: String(r.exam ?? ""),
    session: str(r.session),
    publishedOn: str(r.published_on),
    total: num(r.total),
    max: num(r.max),
    percentage: num(r.percentage),
    grade: str(r.grade),
    result: str(r.result),
    rank: num(r.rank),
    cohort: num(r.cohort),
    subjects: list(r.subjects).map((s) => ({
      subject: String(s.subject ?? ""),
      obtained: num(s.obtained),
      max: num(s.max),
      passed: typeof s.passed === "boolean" ? s.passed : null,
      absent: s.absent === true,
    })),
  }));
  return results.length > 0 ? { student: d.student, results } : null;
}

export type CertificateCheck = {
  serial: string;
  certificate: string;
  issuedOn: string | null;
  holder: string;
  cancelled: boolean;
  cancelledOn: string | null;
};

export function readCertificate(data: unknown): CertificateCheck | null {
  const d = obj(data);
  if (!d || typeof d.serial !== "string") return null;
  return {
    serial: d.serial,
    certificate: String(d.certificate ?? ""),
    issuedOn: str(d.issued_on),
    holder: String(d.holder ?? ""),
    cancelled: d.status === "cancelled",
    cancelledOn: str(d.cancelled_on),
  };
}

/** "09:30:00" → "09:30". A time of day is a wall clock (rule 7), never an instant. */
export function clockTime(value: string | null): string | null {
  return value && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : null;
}

/** "09:30–11:30", or the start alone, or null when the paper has no slot yet. */
export function timeRange(startsAt: string | null, endsAt: string | null): string | null {
  const a = clockTime(startsAt);
  const b = clockTime(endsAt);
  return a && b ? `${a}–${b}` : (a ?? null);
}

/**
 * Which of the write functions' sentences the reader should get in their own
 * language. Anything else is shown as written, because it is a bound the
 * action's own check failed to copy and hiding it behind "try again" would be
 * a lie about what to do.
 */
export function publicRefusalKey(message: string):
  | "public.error.busy"
  | "public.lookup.busy"
  | "public.error.closed"
  | null {
  if (/^Too many lookups/.test(message)) return "public.lookup.busy";
  if (/received a lot of/.test(message)) return "public.error.busy";
  if (/is not taking (enquiries|applications) online/.test(message)) return "public.error.closed";
  return null;
}
