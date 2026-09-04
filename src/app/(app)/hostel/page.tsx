import { BedDouble } from "lucide-react";
import { hasPermission } from "@/lib/auth/permissions";
import { listStaffOptions } from "../hr/actions";
import { getBillingConflicts } from "../transport/actions";
import { listFeeHeads, listHostels, listRooms } from "./actions";
import { HostelView } from "./hostel-view";

export const metadata = { title: "Hostel" };

export default async function HostelPage() {
  const [canView, canManage, canAllocate] = await Promise.all([
    hasPermission("hostel.view"),
    hasPermission("hostel.manage"),
    hasPermission("hostel.allocate"),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Hostel</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ask an administrator to grant you <code className="font-mono">hostel.view</code>.
        </p>
      </div>
    );
  }

  const [hostels, rooms, conflicts, feeHeads, staff] = await Promise.all([
    listHostels(),
    listRooms(),
    // The same detector the transport screen shows. It covers every
    // per-student source, so both screens warn about the same double charge
    // rather than each knowing half of it.
    getBillingConflicts(),
    listFeeHeads(),
    listStaffOptions(),
  ]);

  const beds = hostels.reduce((sum, h) => sum + h.beds, 0);
  const occupied = hostels.reduce((sum, h) => sum + h.occupied, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Hostel</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Boarding houses, their rooms, and who sleeps where. The fare is on the room, not the
            hostel — a four-bed dormitory costs less per child than a two-bed room.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2">
          <BedDouble className="size-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-mono text-lg font-semibold tabular-nums">
              {occupied}
              <span className="text-sm font-normal text-muted-foreground"> / {beds}</span>
            </p>
            <p className="text-xs text-muted-foreground">beds occupied</p>
          </div>
        </div>
      </div>

      <HostelView
        hostels={hostels}
        rooms={rooms}
        conflicts={conflicts}
        feeHeads={feeHeads}
        staff={staff}
        canManage={canManage}
        canAllocate={canAllocate}
      />
    </div>
  );
}
