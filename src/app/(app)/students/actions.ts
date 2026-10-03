"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deletePhotoObject } from "@/lib/storage/photos";
import { getUserContext } from "@/lib/auth/context";
import { studentSchema, type StudentInput } from "@/lib/validations/students";
import { STUDENT_SEARCH_FIELDS, type StudentSearchField } from "@/lib/validations/students-display";
import { admissionBillSentence, parseAdmissionBill } from "@/lib/validations/admission-bill";
import { formatCurrency } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/server";
import type { ActionResult, ListParams } from "../library/actions";

export type StudentRow = {
  id: string;
  admissionNumber: string;
  fullName: string;
  gender: string | null;
  dateOfBirth: string | null;
  status: string;
  sectionLabel: string | null;
  className: string | null;
  sectionName: string | null;
  rollNumber: string | null;
  guardianName: string | null;
  phone: string | null;
  email: string | null;
  admissionDate: string | null;
};

/**
 * Whitelisted so a client-supplied sort key can never reach .order().
 * Keys are the *database* columns; the table maps its column ids onto these.
 */
const STUDENT_SORT_COLUMNS = new Set(["admission_number", "admission_date", "status", "created_at"]);

export async function listStudents(
  params: ListParams & { sectionId?: string; searchField?: string },
): Promise<{ rows: StudentRow[]; total: number }> {
  const [supabase, ctx] = await Promise.all([createClient(), getUserContext()]);
  const { pageIndex, pageSize, sortBy, sortDesc, search, status, sectionId } = params;
  const field: StudentSearchField = STUDENT_SEARCH_FIELDS.includes(params.searchField as StudentSearchField)
    ? (params.searchField as StudentSearchField)
    : "admission_number";
  const term = search?.trim() ?? "";

  // Filtering by class must filter the *students*. A filter on a plain
  // embedded resource only trims the embedded rows, so every student came back
  // and those in other classes simply showed no class; `!inner` makes the
  // enrolment a condition of the row (found by the reference's "Search By
  // Class", which is nothing else).
  const enrolments = sectionId
    ? "enrolments!inner ( roll_number, section_id, session_id, sections ( name, class_levels ( name, sequence ) ) )"
    : "enrolments ( roll_number, section_id, session_id, sections ( name, class_levels ( name, sequence ) ) )";
  // A person-column search makes the person a condition of the row, for the
  // same reason; every student has one, so `!inner` drops nobody otherwise.
  const people = term && ["phone", "email", "address"].includes(field) ? "people:person_id!inner" : "people:person_id";
  let query = supabase
    .from("students")
    .select(
      `id, admission_number, admission_date, status,
       ${people} ( first_name, last_name, gender, date_of_birth, phone, email ),
       ${enrolments},
       guardian_student ( is_primary, guardians ( people:person_id ( first_name, last_name ) ) )`,
      { count: "exact" },
    );

  if (term) {
    const pattern = `%${term}%`;
    if (field === "admission_number") query = query.ilike("admission_number", pattern);
    else if (field === "phone") query = query.ilike("people.phone", pattern);
    else if (field === "email") query = query.ilike("people.email", pattern);
    else if (field === "address") query = query.ilike("people.address_line1", pattern);
    else {
      // A name is two columns, and joining them into an `.or()` filter string
      // is building a query out of somebody's typing (rule 4, 0259); the
      // bound-parameter search the pickers use answers it instead.
      const { data: hits, error: searchError } = await supabase.rpc("student_search", {
        p_query: term,
        p_limit: 1000,
      });
      if (searchError) throw new Error(searchError.message);
      const ids = (hits ?? []).map((h) => h.id);
      if (ids.length === 0) return { rows: [], total: 0 };
      query = query.in("id", ids);
    }
  }
  if (status) {
    query = query.eq("status", status);
  }
  if (sectionId) {
    query = query.eq("enrolments.section_id", sectionId);
  } else if (ctx?.currentSessionId) {
    // The class shown is this year's: a student's enrolments span years, and
    // the first one the join returned was whichever came first (rule 2).
    query = query.eq("enrolments.session_id", ctx.currentSessionId);
  }

  const orderColumn = sortBy && STUDENT_SORT_COLUMNS.has(sortBy) ? sortBy : "admission_number";
  query = query
    .order(orderColumn, { ascending: !sortDesc })
    // The default (`admission_number`) is unique and needed no tiebreak, which
    // is why this went unnoticed — but `status` is **1 distinct value over 303
    // rows**, so sorting the roll by it made every page an arbitrary slice.
    .order("admission_number", { ascending: true })
    .range(pageIndex * pageSize, pageIndex * pageSize + pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  return {
    rows: (data ?? []).map((s) => {
      const person = s.people;
      const enrolment = Array.isArray(s.enrolments) ? s.enrolments[0] : s.enrolments;
      const level = enrolment?.sections?.class_levels;
      const links = Array.isArray(s.guardian_student) ? s.guardian_student : [];
      const primary = links.find((l) => l.is_primary) ?? links[0];
      const guardianPerson = primary?.guardians?.people;

      return {
        id: s.id,
        admissionNumber: s.admission_number,
        fullName: person ? `${person.first_name} ${person.last_name}` : "—",
        gender: person?.gender ?? null,
        dateOfBirth: person?.date_of_birth ?? null,
        status: s.status,
        sectionLabel:
          level && enrolment?.sections ? `${level.name} · ${enrolment.sections.name}` : null,
        className: level?.name ?? null,
        sectionName: enrolment?.sections?.name ?? null,
        rollNumber: enrolment?.roll_number ?? null,
        guardianName: guardianPerson
          ? `${guardianPerson.first_name} ${guardianPerson.last_name}`
          : null,
        phone: person?.phone ?? null,
        email: person?.email ?? null,
        admissionDate: s.admission_date ?? null,
      };
    }),
    total: count ?? 0,
  };
}

/**
 * The class picker, on seventeen screens.
 *
 * **Scoped to the current academic year, which it was not.** `sections` carries
 * `session_id` — rule 2 puts it there so every query can filter on it without a
 * join — and this one did not, so it returned 24 rows across two years with
 * *"Grade 1 · A"* appearing twice under the same label and no way to tell them
 * apart. A bursar setting a fee structure, a teacher publishing study material
 * and an office enrolling a child could each pick last year's class and be
 * right about the name.
 *
 * RLS does not help here and is not supposed to: a policy answers *which tenant*
 * and *whose rows*, never *which year*. The year is a label, and a label is only
 * enforced by the reader.
 */
export async function listSections() {
  const ctx = await getUserContext();
  const supabase = await createClient();
  let query = supabase
    .from("sections")
    .select("id, name, class_levels ( name, sequence )")
    .order("name");

  if (ctx?.currentSessionId) query = query.eq("session_id", ctx.currentSessionId);

  const { data } = await query;

  return (data ?? [])
    .map((s) => ({
      id: s.id,
      label: s.class_levels ? `${s.class_levels.name} · ${s.name}` : s.name,
      sequence: s.class_levels?.sequence ?? 0,
    }))
    .sort((a, b) => a.sequence - b.sequence || a.label.localeCompare(b.label));
}

export async function getStudent(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .select(
      `id, admission_number, admission_date, status,
       people:person_id ( first_name, middle_name, last_name, date_of_birth, gender,
                          blood_group, email, phone, address_line1, address_line2,
                          city, state, postal_code, photo_path ),
       enrolments ( session_id, roll_number, status, section_id, sections ( name, class_levels ( name ) ) ),
       guardian_student ( guardian_id, relationship, is_primary, can_pickup,
                          guardians ( occupation,
                                      people:person_id ( first_name, middle_name, last_name,
                                                         phone, email, address_line1, city, state ) ) ),
       members ( membership_number, status,
                 book_issues ( id, status, due_at, books ( title ) ) )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

function toPersonPayload(v: StudentInput) {
  return {
    first_name: v.firstName,
    middle_name: v.middleName ?? "",
    last_name: v.lastName,
    date_of_birth: v.dateOfBirth ?? "",
    gender: v.gender ?? "",
    blood_group: v.bloodGroup ?? "",
    email: v.email ?? "",
    phone: v.phone ?? "",
    address_line1: v.addressLine1 ?? "",
    address_line2: v.addressLine2 ?? "",
    city: v.city ?? "",
    state: v.state ?? "",
    postal_code: v.postalCode ?? "",
  };
}

/** Postgres unique violation -- surfaced as a field error, not a crash. */
function duplicateAdmissionNumber(message: string): ActionResult<never> {
  return {
    ok: false,
    error: "That admission number is already used by another student.",
    fieldErrors: { admissionNumber: [message] },
  };
}

/**
 * `billing` is the second fact the office is told: whether the admission fee
 * was invoiced (0286). Null when no fee head is set to bill on admission.
 * A failed bill never fails the admission -- the child is admitted either way.
 */
export async function admitStudent(
  input: unknown,
): Promise<
  ActionResult<{
    id: string;
    billing: { billed: boolean; message: string } | null;
    arrangements: { ok: boolean; message: string }[];
  }>
> {
  const parsed = studentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admit_student", {
    p_person: toPersonPayload(parsed.data),
    p_admission_number: parsed.data.admissionNumber,
    p_admission_date: parsed.data.admissionDate,
    // `undefined` rather than `null`: both defaulted parameters are
    // `DEFAULT NULL`, so omitting them and passing null mean the same thing to
    // Postgres, and the generated types describe an optional argument.
    p_section_id: parsed.data.sectionId || undefined,
    p_roll_number: parsed.data.rollNumber || undefined,
  });

  if (error) {
    if (error.code === "23505") return duplicateAdmissionNumber("Already in use");
    return { ok: false, error: error.message };
  }

  const id = (data as { id: string }).id;

  // A second call, after the admission has committed: nothing that happens
  // here can undo it. The importer does not come this way -- it loads an
  // existing roll, whose fees were settled before this product existed.
  let billing: { billed: boolean; message: string } | null = null;
  const bill = await supabase.rpc("fees_bill_on_admission", { p_student_id: id });
  if (bill.error) {
    billing = { billed: false, message: `The admission fee was not billed: ${bill.error.message}` };
  } else {
    const parsed = parseAdmissionBill(bill.data);
    const money = parsed.billed ? formatCurrency(parsed.amount, await getLocale()) : "";
    const message = admissionBillSentence(parsed, money);
    if (message) billing = { billed: parsed.billed, message };
  }

  // The bus seat and the bed chosen on the form (0296), through the modules'
  // own write functions after the admission has committed. A refused seat is
  // not a refused admission -- the fee bill's rule above -- so each is a
  // sentence beside the success, never a failure of it.
  const arrangements: { ok: boolean; message: string }[] = [];
  if (parsed.data.busStopId) {
    const seat = await supabase.rpc("transport_assign_student", {
      p_student_id: id,
      p_stop_id: parsed.data.busStopId,
      p_direction: "both",
    });
    arrangements.push(
      seat.error
        ? { ok: false, message: `No bus seat: ${seat.error.message}` }
        : { ok: true, message: "Put on the bus." },
    );
  }
  if (parsed.data.hostelRoomId) {
    const bed = await supabase.rpc("hostel_allocate", {
      p_student_id: id,
      p_room_id: parsed.data.hostelRoomId,
    });
    arrangements.push(
      bed.error
        ? { ok: false, message: `No hostel bed: ${bed.error.message}` }
        : { ok: true, message: "Given a hostel bed." },
    );
  }

  revalidatePath("/students");
  return { ok: true, data: { id, billing, arrangements } };
}

export async function updateStudent(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = studentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_student", {
    p_student_id: id,
    p_person: toPersonPayload(parsed.data),
    p_admission_number: parsed.data.admissionNumber,
    p_admission_date: parsed.data.admissionDate,
    p_status: parsed.data.status,
    // `undefined` rather than `null`: both defaulted parameters are
    // `DEFAULT NULL`, so omitting them and passing null mean the same thing to
    // Postgres, and the generated types describe an optional argument.
    p_section_id: parsed.data.sectionId || undefined,
    p_roll_number: parsed.data.rollNumber || undefined,
  });

  if (error) {
    if (error.code === "23505") return duplicateAdmissionNumber("Already in use");
    return { ok: false, error: error.message };
  }

  revalidatePath("/students");
  revalidatePath(`/students/${id}`);
  return { ok: true, data: { id } };
}

/**
 * Students are never deleted -- alumni, transfers and re-admission all depend
 * on the record surviving. Status change is the destructive action, and it is
 * reversible, which is why the UI can offer an undo.
 */
/** The statuses that mean a child has left, rather than merely changed state. */
const LEAVING_STATUSES = ["transferred", "alumni", "expelled", "inactive"] as const;

export type ExitOutcome = {
  closed: {
    enrolments: number;
    transport: number;
    hostel: number;
    concessions: number;
    /**
     * The library membership, closed as `expired` by migration `0191`. Not
     * `suspended`: a suspension is something a librarian does about behaviour,
     * and this is a card that ran out because the child is no longer here.
     */
    library: number;
  };
  outstanding: { kind: string; message: string }[];
};

/**
 * Setting a leaving status **performs the exit**; it does not just write the
 * word.
 *
 * This function used to be one `update ... set status`, which is precisely the
 * gap migration `0174` closed in the certificate path: four of the five read
 * paths that decide what a child is charged and told never consult
 * `students.status`, so the flag alone left them enrolled, on a bus, in a
 * hostel bed and receiving absence texts. Two ways to set the same flag, one of
 * which quietly did nothing, is worse than one — so this one routes through the
 * same act.
 *
 * A reason is required for a leaving status because `student_exit` requires
 * one: it is the only thing a record five years from now will have.
 */
export async function setStudentStatus(
  id: string,
  status: string,
  reason?: string,
): Promise<ActionResult<ExitOutcome | null>> {
  const supabase = await createClient();

  if ((LEAVING_STATUSES as readonly string[]).includes(status)) {
    if (!reason || reason.trim().length < 3) {
      return { ok: false, error: "Say why this child is leaving." };
    }

    const { data, error } = await supabase.rpc("student_exit", {
      p_student_id: id,
      p_reason: reason.trim(),
      p_status: status,
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/students");
    revalidatePath(`/students/${id}`);
    return { ok: true, data: (data as unknown as ExitOutcome) ?? null };
  }

  // Coming back on the roll. Deliberately *not* the inverse act: re-enrolling
  // a child into a class is a decision with a section and a roll number in it,
  // and `student_exit_problems()` names anybody left active without one rather
  // than this guessing.
  const { error } = await supabase.from("students").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/students");
  revalidatePath(`/students/${id}`);
  return { ok: true, data: null };
}

/**
 * Delete a student admitted by mistake (0288), with any guardian left with no
 * child here. A trigger on `students` refuses anybody with history -- fees,
 * register, marks -- naming what is held; that sentence is the error. The
 * photograph goes after the row, for the reason `deleteStaffRecord` gives.
 */
export async function deleteStudentRecord(id: string): Promise<ActionResult<{ name: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_delete", { p_student_id: id });
  if (error) return { ok: false, error: error.message };

  const result = data as unknown as { name: string; photoPath: string | null };
  if (result.photoPath) await deletePhotoObject(result.photoPath);

  revalidatePath("/students");
  return { ok: true, data: { name: result.name } };
}
