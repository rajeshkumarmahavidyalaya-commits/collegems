"use server";

import { createClient } from "@/lib/supabase/server";

export type SearchResult = {
  id: string;
  type: "student" | "staff" | "book";
  title: string;
  subtitle: string;
  href: string;
};

export async function globalSearch(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const supabase = await createClient();
  const like = `%${q}%`;

  const [students, studentsByName, staff, staffByName, books] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_number, people:person_id ( first_name, last_name )")
      .ilike("admission_number", like)
      .limit(5),
    supabase
      .from("students")
      .select("id, admission_number, people:person_id!inner ( first_name, last_name )")
      .or(`first_name.ilike.${like},last_name.ilike.${like}`, { referencedTable: "people" })
      .limit(5),
    supabase
      .from("staff")
      .select("id, employee_code, designation, people:person_id ( first_name, last_name )")
      .or(`employee_code.ilike.${like},designation.ilike.${like}`)
      .limit(5),
    supabase
      .from("staff")
      .select("id, employee_code, designation, people:person_id!inner ( first_name, last_name )")
      .or(`first_name.ilike.${like},last_name.ilike.${like}`, { referencedTable: "people" })
      .limit(5),
    supabase.from("books").select("id, title, author").or(`title.ilike.${like},author.ilike.${like}`).limit(5),
  ]);

  const results: SearchResult[] = [];
  const seenStudents = new Set<string>();
  const seenStaff = new Set<string>();

  for (const s of [...(students.data ?? []), ...(studentsByName.data ?? [])]) {
    if (seenStudents.has(s.id)) continue;
    seenStudents.add(s.id);
    const name = s.people ? `${s.people.first_name} ${s.people.last_name}` : s.admission_number;
    results.push({
      id: s.id,
      type: "student",
      title: name,
      subtitle: `Admission #${s.admission_number}`,
      href: `/library/members`,
    });
  }
  for (const s of [...(staff.data ?? []), ...(staffByName.data ?? [])]) {
    if (seenStaff.has(s.id)) continue;
    seenStaff.add(s.id);
    const name = s.people ? `${s.people.first_name} ${s.people.last_name}` : s.employee_code;
    results.push({
      id: s.id,
      type: "staff",
      title: name,
      subtitle: s.designation,
      href: `/library/members`,
    });
  }
  for (const b of books.data ?? []) {
    results.push({
      id: b.id,
      type: "book",
      title: b.title,
      subtitle: b.author,
      href: `/library/books/${b.id}`,
    });
  }

  return results;
}
