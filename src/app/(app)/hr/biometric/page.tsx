import { hasPermission } from "@/lib/auth/permissions";
import { getLocale } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/i18n/format";
import {
  collegeTimezone,
  listDevices,
  listProblems,
  listRecentPunches,
  listStaffCodes,
  readerEndpoint,
} from "./actions";
import { BiometricView, type ShownPunch } from "./biometric-view";

export const metadata = { title: "Attendance readers" };

/**
 * Fingerprint and card readers at the gate, feeding the staff register.
 *
 * Gated on `hr.manage`, the permission that marks the register by hand -- the
 * reader is a second way of writing the same rows, so it belongs to whoever
 * decides the first. The tables underneath are administrator-only by policy;
 * `hr.manage` is administrator-alone in the default matrix, so the two agree
 * today, and a college that grants it to somebody else meets an empty list
 * rather than somebody else's device secrets.
 */
export default async function BiometricPage() {
  const canManage = await hasPermission("hr.manage");
  if (!canManage) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Attendance readers</h1>
        <p className="text-sm text-muted-foreground">
          Only somebody who marks the staff register can set up the readers that mark it.
        </p>
      </div>
    );
  }

  const [devices, staff, punches, problems, timezone, endpoint, locale] = await Promise.all([
    listDevices(),
    listStaffCodes(),
    listRecentPunches(),
    listProblems(),
    collegeTimezone(),
    readerEndpoint(),
    getLocale(),
  ]);

  const deviceName = new Map(devices.map((d) => [d.id, d.name]));
  const staffName = new Map(staff.map((s) => [s.staffId, s.name]));
  const shown: ShownPunch[] = punches.map((p) => ({
    ...p,
    device: deviceName.get(p.deviceId) ?? "—",
    person: p.staffId ? (staffName.get(p.staffId) ?? null) : null,
    // The college's wall clock: Vercel renders in UTC.
    when: formatDateTime(p.punchedAt, locale, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Attendance readers</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A fingerprint or card reader at the gate marks the staff register from each person&apos;s
          first and last punch of the day. It never changes a day somebody in the office has already
          marked — if you record a teacher as on duty, the reader does not overrule you.
        </p>
      </div>
      <BiometricView
        devices={devices}
        staff={staff}
        punches={shown}
        problems={problems}
        endpoint={endpoint}
      />
    </div>
  );
}
