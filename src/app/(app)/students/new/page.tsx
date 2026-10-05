import Link from "next/link";
import { redirect } from "next/navigation";
import { FileUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { STUDENT_TYPE_WRITERS } from "@/lib/validations/student-types";
import { hasPermission } from "@/lib/auth/permissions";
import { admissionOptions, admissionSettings } from "../actions";
import { bedOptions, busStopOptions } from "../arrangement-actions";
import { StudentForm } from "../student-form";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Admit student" };

export default async function NewStudentPage() {
  const [options, canManage, canAssignBus, canAllocateBed, ctx, canImport, settings] = await Promise.all([
    admissionOptions(),
    hasPermission("students.manage"),
    hasPermission("transport.assign"),
    hasPermission("hostel.allocate"),
    getUserContext(),
    hasPermission("import.view"),
    admissionSettings(),
  ]);
  // Offered only to somebody who may assign them: a field whose write will be
  // refused is a control that costs the person the work of trying.
  const [busStops, hostelRooms] = await Promise.all([
    canAssignBus ? busStopOptions() : Promise.resolve([]),
    canAllocateBed ? bedOptions() : Promise.resolve([]),
  ]);

  // A route with no stops, or a hostel with no rooms, offers nothing to pick,
  // and the field would simply be absent -- the shape of a class with no
  // section. Say so instead, to somebody who may assign one.
  const supabase = await createClient();
  const [routes, hostels] = await Promise.all([
    canAssignBus && busStops.length === 0
      ? supabase.from("transport_routes").select("id", { count: "exact", head: true }).eq("is_active", true)
      : Promise.resolve({ count: 0 }),
    canAllocateBed && hostelRooms.length === 0
      ? supabase.from("hostels").select("id", { count: "exact", head: true }).eq("is_active", true)
      : Promise.resolve({ count: 0 }),
  ]);
  const arrangementHints = [
    (routes.count ?? 0) > 0 ? "The bus routes have no stops yet, so there is no seat to choose. Add stops under Transport." : null,
    (hostels.count ?? 0) > 0 ? "The hostels have no rooms yet, so there is no bed to choose. Add rooms under Hostel." : null,
  ].filter((h): h is string => h !== null);

  // The RLS policy is the real gate; this just avoids showing a form whose
  // submit is guaranteed to be rejected.
  if (!canManage) redirect("/students");

  return (
    <div className="reference-admission flex w-full flex-col gap-4">
      {/* The reference's title and its two buttons. Bulk Admission is drawn on
          import.view, which the import screen checks; the roll is readable by
          anybody who may admit. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            New Admission For Session: {ctx?.currentSessionName ?? "—"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Creates the person, their student record, and their place in a class together.
            Fields marked * are required.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canImport && (
            <Button asChild variant="outline">
              <Link href="/students/import">
                <FileUp className="size-4" aria-hidden="true" />
                Bulk Admission
              </Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/students">
              <Users className="size-4" aria-hidden="true" />
              View Students
            </Link>
          </Button>
        </div>
      </div>
      <StudentForm
        options={options}
        settings={settings}
        // Mirrors "finance roles manage student_types": the button is drawn for
        // the two roles whose write the policy accepts.
        canAddType={STUDENT_TYPE_WRITERS.includes(ctx?.roleCode ?? "")}
        // Mirrors "admins manage student_profiles" (0331): the only write policy.
        profileEditable={ctx?.roleCode === "admin"}
        busStops={busStops}
        hostelRooms={hostelRooms}
        arrangementHints={arrangementHints}
      />
    </div>
  );
}
