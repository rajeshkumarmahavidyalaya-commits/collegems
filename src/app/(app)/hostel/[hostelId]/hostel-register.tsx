"use client";

import { Printer, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RegisterRow } from "../actions";

/**
 * The warden's register: room by room, who is in it, and a number to ring.
 * Prints through the global stylesheet, like the bus manifest and the fee
 * invoice — a boarding house does a roll call on paper at night.
 */
export function HostelRegister({
  hostelName,
  rows,
}: {
  hostelName: string;
  rows: RegisterRow[];
}) {
  const boarders = rows.filter((r) => r.studentId !== null);
  const emptyRooms = rows.filter((r) => r.studentId === null);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Register</CardTitle>
          <CardDescription className="max-w-2xl">
            {hostelName} — {boarders.length} {boarders.length === 1 ? "boarder" : "boarders"}
            {emptyRooms.length > 0 &&
              `, ${emptyRooms.length} ${emptyRooms.length === 1 ? "room" : "rooms"} empty`}
            . Only the primary guardian&apos;s number is shown.
          </CardDescription>
        </div>
        <Button
          data-print="hide"
          type="button"
          variant="outline"
          onClick={() => window.print()}
          className="cursor-pointer"
        >
          <Printer className="size-4" aria-hidden="true" />
          Print
        </Button>
      </CardHeader>
      <CardContent>
        {boarders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Users className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">Nobody is boarding here yet</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Add rooms with fares, then place children in them from the hostel screen.
              </p>
            </div>
          </div>
        ) : (
          <div data-print="sheet" className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead>Child</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Guardian</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boarders.map((row, index) => (
                  <TableRow key={`${row.roomId}-${row.studentId}-${index}`} data-print="keep">
                    <TableCell>
                      <span className="font-mono font-medium">{row.roomNumber}</span>
                      {row.floor && (
                        <span className="block text-xs text-muted-foreground">{row.floor}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{row.studentName}</span>
                      {row.admissionNumber && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {row.admissionNumber}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.sectionLabel ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">
                      {row.startsOn ?? "—"}
                    </TableCell>
                    <TableCell>
                      {row.guardianPhone ? (
                        <>
                          <a
                            href={`tel:${row.guardianPhone}`}
                            className="font-mono underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {row.guardianPhone}
                          </a>
                          {row.guardianName && (
                            <span className="block text-xs text-muted-foreground">
                              {row.guardianName}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">No number on file</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
