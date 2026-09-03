import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { schoolToday } from "@/lib/validations/homework";
import {
  getLeaveBalance,
  listLeaveRequests,
  listLeaveTypes,
  listStaffOptions,
} from "../actions";
import { LeaveBoard } from "./leave-board";

export const metadata = { title: "Leave" };

export default async function LeavePage() {
  const [ctx, requests, types, canDecide] = await Promise.all([
    getUserContext(),
    listLeaveRequests(),
    listLeaveTypes(),
    hasPermission("hr.manage"),
  ]);

  // An administrator's balance card would be meaningless — they are looking at
  // everybody's requests, not their own — so it shows theirs only when they
  // have a staff record to have a balance against.
  const [balance, staff] = await Promise.all([
    ctx?.staffId ? getLeaveBalance() : Promise.resolve([]),
    canDecide ? listStaffOptions() : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Leave</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {canDecide
            ? "Every request, and the balance behind it. A balance is derived from the approved requests each time it is asked for — a stored number would be free to disagree with them."
            : "Your leave, and what is left of each kind. Only unpaid leave reaches a payslip."}
        </p>
      </div>

      <LeaveBoard
        requests={requests}
        balance={balance}
        types={types}
        staff={staff.map((s) => ({ id: s.id, label: s.label }))}
        canDecide={canDecide}
        canApply={Boolean(ctx?.staffId) || canDecide}
        today={schoolToday()}
      />
    </div>
  );
}
