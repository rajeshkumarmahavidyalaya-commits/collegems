"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check, Loader2, Lock, Trash2, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { discardSeatPlan, moveSeat, publishSeatPlan, reopenSeatPlan } from "../../../seating-actions";
import type { SeatRow } from "../../../seating-actions";

type Room = { id: string; name: string; capacity: number };

/**
 * The chart, and the one act that edits it.
 *
 * This is a client component because every row carries a *Move* control, and
 * the office's real work here is moving three or four named candidates — rule
 * 13's whole argument for an editable preview rather than a report.
 *
 * It renders the rows itself rather than taking a server-rendered table as
 * children, which costs the RSC payload for the chart. That is a data cost, not
 * a bundle cost: the component is one module, and the alternative — a client
 * button per row around a server-rendered cell — is three hundred islands.
 */
export function SeatChart({
  planId,
  status,
  rooms,
  allRooms,
  canManage,
}: {
  planId: string;
  status: string;
  rooms: { roomId: string; roomName: string; seats: SeatRow[] }[];
  allRooms: Room[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [moving, setMoving] = useState<SeatRow | null>(null);
  const [toRoom, setToRoom] = useState("");
  const [toSeat, setToSeat] = useState("");
  const [note, setNote] = useState("");

  const draft = status === "draft";

  function act(run: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await run();
      // The refusal is the database's sentence, and it names the next action.
      if (!result.ok) return void toast.error(result.error ?? "That did not work.");
      toast.success(done);
      router.refresh();
    });
  }

  function submitMove() {
    if (!moving) return;
    const seat = Number(toSeat);
    if (!Number.isInteger(seat) || seat < 1) return void toast.error("Give a seat number.");
    startTransition(async () => {
      const result = await moveSeat(moving.allocationId, toRoom, seat, note);
      if (!result.ok) return void toast.error(result.error);
      toast.success(
        result.data.swapped
          ? "Swapped with the candidate who was in that seat. Both are recorded as moved by hand."
          : "Moved.",
      );
      setMoving(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div className="flex flex-wrap gap-2" data-print="hide">
          {draft ? (
            <>
              <Button
                onClick={() => act(() => publishSeatPlan(planId), "Published. Every candidate can now see their own seat.")}
                disabled={pending}
              >
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                Publish
              </Button>
              <Button
                variant="outline"
                onClick={() => act(() => discardSeatPlan(planId), "Discarded.")}
                disabled={pending}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Discard
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() =>
                act(
                  () => reopenSeatPlan(planId),
                  "Reopened. It is no longer visible to candidates until you publish it again.",
                )
              }
              disabled={pending}
            >
              <Unlock className="size-4" aria-hidden="true" />
              Reopen for editing
            </Button>
          )}
        </div>
      )}

      {rooms.map((room) => (
        <Card key={room.roomId}>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {room.roomName}
              <Badge variant="secondary">
                {room.seats.length} of {room.seats[0]?.plannedCapacity ?? 0} seats
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Wide tables scroll inside their own container, never the page. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Seat</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Candidate</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Roll</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Paper</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Class</th>
                    {canManage && draft && <th scope="col" className="py-2 text-end font-medium">Move</th>}
                  </tr>
                </thead>
                <tbody>
                  {room.seats.map((seat) => (
                    <tr key={seat.allocationId || `${seat.roomId}:${seat.seatNo}`} className="border-b last:border-0">
                      <td className="py-2 pe-3 font-mono tabular-nums">{seat.seatNo}</td>
                      <td className="py-2 pe-3">
                        {seat.studentName}
                        {/* Never colour alone: the reason travels with the badge. */}
                        {seat.isOverride && (
                          <Badge variant="outline" className="ms-2" title={seat.note ?? undefined}>
                            moved by hand
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pe-3 font-mono tabular-nums text-muted-foreground">
                        {seat.rollNumber ?? seat.admissionNumber}
                      </td>
                      <td className="py-2 pe-3">{seat.paper}</td>
                      <td className="py-2 pe-3 text-muted-foreground">{seat.sectionLabel}</td>
                      {canManage && draft && (
                        <td className="py-2 text-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setMoving(seat);
                              setToRoom(seat.roomId);
                              setToSeat(String(seat.seatNo));
                              setNote("");
                            }}
                          >
                            <ArrowLeftRight className="size-3.5" aria-hidden="true" />
                            <span className="sr-only">Move {seat.studentName}</span>
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      {!draft && canManage && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          A published plan cannot be edited. Reopen it first — which withdraws it from the families
          who have already been told.
        </p>
      )}

      <Dialog open={moving !== null} onOpenChange={(open) => !open && setMoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {moving?.studentName}</DialogTitle>
            <DialogDescription>
              If somebody is already in that seat the two are swapped, because that is what moving
              one candidate into a full room means. Both are recorded as moved by hand.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="move-room">Room</Label>
              <Select value={toRoom} onValueChange={setToRoom}>
                <SelectTrigger id="move-room">
                  <SelectValue placeholder="Choose a room" />
                </SelectTrigger>
                <SelectContent>
                  {allRooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} · {r.capacity} seats
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="move-seat">Seat number</Label>
              <Input
                id="move-seat"
                inputMode="numeric"
                value={toSeat}
                onChange={(e) => setToSeat(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="move-note">Why</Label>
              <Input
                id="move-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Sitting near the door after an ankle injury"
              />
              {/* The function refuses without this, and it keeps what it asks
                  for: the reason is on the row and in the audit log. */}
              <p className="text-xs text-muted-foreground">
                Required. It is the only thing a plan read next year will have to explain why this
                candidate is not where the rules put them.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submitMove} disabled={pending || !toRoom || note.trim().length < 3}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
