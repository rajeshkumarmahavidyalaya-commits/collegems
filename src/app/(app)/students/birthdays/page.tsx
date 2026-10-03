import Link from "next/link";
import { Cake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageToolbar } from "@/components/page-toolbar";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { ExportRowsButton } from "@/components/export-rows-button";

export const metadata = { title: "Students Birthdays" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The reference's Students Birthdays: active students whose birthday falls
 * between two dates, soonest first. `student_birthdays` is INVOKER, so what a
 * person is shown is what the policies on students and people let them read;
 * the page gates on `students.view` so a role with no reason to list the roll
 * is told so rather than shown an empty table (rule 4). It opens on the next
 * thirty days from the school's today.
 */
export default async function BirthdaysPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [canView, params, locale] = await Promise.all([hasPermission("students.view"), searchParams, getLocale()]);
  if (!canView) {
    return (
      <div className="flex flex-col gap-4">
        <PageToolbar title="Students Birthdays" icon={Cake} />
        <p className="max-w-2xl text-sm text-muted-foreground">
          The birthday list is drawn from the student roll, which your role does not list.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: todayData } = await supabase.rpc("mobile_today");
  const today = typeof todayData === "string" && ISO.test(todayData) ? todayData : new Date().toISOString().slice(0, 10);
  const from = params.from && ISO.test(params.from) ? params.from : today;
  const to = params.to && ISO.test(params.to) ? params.to : addDays(from, 30);

  const { data, error } = await supabase.rpc("student_birthdays", { p_from: from, p_to: to });
  const rows = data ?? [];
  const dash = "—";

  const exportRows = [
    ["Admission Number", "Name", "Class", "Section", "Phone", "DOB", "Email", "Birthday", "Turns"],
    ...rows.map((r) => [
      r.admission_number,
      r.full_name,
      r.class_name ?? "",
      r.section_name ?? "",
      r.phone ?? "",
      r.date_of_birth,
      r.email ?? "",
      r.next_birthday,
      String(r.turns),
    ]),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Students Birthdays" icon={Cake} />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4" aria-label="Choose the dates">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="birthdays-from">Start Date</Label>
          <Input id="birthdays-from" name="from" type="date" defaultValue={from} className="w-44" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="birthdays-to">End Date</Label>
          <Input id="birthdays-to" name="to" type="date" defaultValue={to} className="w-44" />
        </div>
        <Button type="submit" className="cursor-pointer">
          Fetch
        </Button>
        <div className="ms-auto">
          <ExportRowsButton rows={exportRows} fileName={`birthdays-${from}-to-${to}.csv`} />
        </div>
      </form>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          {error.message}
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-card px-6 py-10 text-center">
          <p className="font-medium">No birthdays between {formatDate(from, locale)} and {formatDate(to, locale)}.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Only students with a date of birth on their record are listed.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admission Number</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>DOB</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Birthday</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.student_id}>
                  <TableCell className="font-mono text-xs">{r.admission_number}</TableCell>
                  <TableCell>
                    <Link href={`/students/${r.student_id}`} className="underline-offset-2 hover:underline">
                      {r.full_name}
                    </Link>
                  </TableCell>
                  <TableCell>{r.class_name ?? dash}</TableCell>
                  <TableCell>{r.section_name ?? dash}</TableCell>
                  <TableCell>{r.phone ?? dash}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(r.date_of_birth, locale)}</TableCell>
                  <TableCell className="max-w-48 truncate">{r.email ?? dash}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(r.next_birthday, locale)}
                    <span className="block text-xs text-muted-foreground">Turns {r.turns}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
