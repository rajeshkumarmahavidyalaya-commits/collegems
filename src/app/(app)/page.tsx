import { BookMarked, Building2, GraduationCap, TriangleAlert, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { StatCard } from "@/components/dashboard/stat-card";
import { EnrollmentChart, type EnrollmentDatum } from "@/components/dashboard/enrollment-chart";
import { DonutChart, type DonutDatum } from "@/components/dashboard/donut-chart";

export const metadata = { title: "Dashboard" };

const GENDER_LABEL: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  undisclosed: "Undisclosed",
};

export default async function DashboardPage() {
  const ctx = await getUserContext();
  const supabase = await createClient();

  const [studentsRes, staffRes, sectionsRes, booksRes, issuesRes, enrolmentsRes] = await Promise.all([
    supabase.from("students").select("id, status", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("sections").select("id", { count: "exact", head: true }),
    supabase.from("books").select("total_copies"),
    supabase.from("book_issues").select("status, due_at"),
    supabase
      .from("enrolments")
      .select(
        "sections ( name, class_levels ( name, sequence ) ), students!inner ( status, people:person_id ( gender ) )",
      )
      .eq("status", "active")
      .eq("students.status", "active"),
  ]);

  const totalBookCopies = (booksRes.data ?? []).reduce((sum, b) => sum + b.total_copies, 0);
  const issued = (issuesRes.data ?? []).filter((i) => i.status === "issued");
  const overdue = issued.filter((i) => i.due_at < new Date().toISOString().slice(0, 10));
  const returned = (issuesRes.data ?? []).filter((i) => i.status === "returned");

  const byGrade = new Map<string, { sequence: number; count: number }>();
  const byGender = new Map<string, number>();

  for (const row of enrolmentsRes.data ?? []) {
    const level = row.sections?.class_levels;
    if (level) {
      const entry = byGrade.get(level.name) ?? { sequence: level.sequence, count: 0 };
      entry.count += 1;
      byGrade.set(level.name, entry);
    }
    const gender = row.students?.people?.gender ?? "undisclosed";
    byGender.set(gender, (byGender.get(gender) ?? 0) + 1);
  }

  const enrollmentData: EnrollmentDatum[] = Array.from(byGrade.entries())
    .sort((a, b) => a[1].sequence - b[1].sequence)
    .map(([grade, v]) => ({ grade, students: v.count }));

  const genderData: DonutDatum[] = Array.from(byGender.entries()).map(([gender, value]) => ({
    name: GENDER_LABEL[gender] ?? gender,
    value,
  }));

  const libraryStatusData: DonutDatum[] = [
    { name: "Issued (on time)", value: issued.length - overdue.length },
    { name: "Overdue", value: overdue.length },
    { name: "Returned", value: returned.length },
  ].filter((d) => d.value > 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {ctx?.displayName.split(" ")[0]}</h1>
        <p className="text-sm text-muted-foreground">
          {ctx?.tenantName} · {ctx?.currentSessionName ?? "No active session"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active students" value={String(studentsRes.count ?? 0)} icon={GraduationCap} />
        <StatCard label="Active staff" value={String(staffRes.count ?? 0)} icon={Users} />
        <StatCard label="Sections" value={String(sectionsRes.count ?? 0)} icon={Building2} />
        <StatCard
          label="Books overdue"
          value={String(overdue.length)}
          icon={TriangleAlert}
          tone={overdue.length > 0 ? "warning" : "success"}
          hint={`${totalBookCopies} total copies in catalog`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EnrollmentChart data={enrollmentData} />
        </div>
        <DonutChart title="Students by gender" description="Active enrolments" data={genderData} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DonutChart
          title="Library activity"
          description="Current issue status across all books"
          data={libraryStatusData}
        />
        <StatCard
          label="Books issued right now"
          value={String(issued.length)}
          icon={BookMarked}
          hint="Across all active members"
        />
      </div>
    </div>
  );
}
