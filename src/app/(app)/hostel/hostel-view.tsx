"use client";

import { useEffect, useState, useTransition } from "react";

import Link from "next/link";

import { useRouter } from "next/navigation";

import { useQuery } from "@tanstack/react-query";

import {
  AlertTriangle,
  BedDouble,
  Building2,
  Loader2,
  Pencil,
  Plus,
  Search,
  UserPlus,
  X,
} from "lucide-react";

import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  bedsSentence,
  genderAllowed,
  hostelKindLabel,
  occupancyTone,
} from "@/lib/validations/hostel-display";
import { useI18n } from "@/components/providers/i18n-provider";

import {
  allocateStudent,
  searchStudentsForHostel,
  type BoarderHit,
  type HostelRow,
  type RoomRow,
} from "./actions";
import dynamic from "next/dynamic";

// Loaded on the click that opens them and rendered only while open: they
// hold this page's Zod and form code, and a conditional render is not a
// conditional load (see `fees-table.tsx` and docs/performance.md).
const HostelDialog = dynamic(() =>
  import("./hostel-dialogs").then((m) => m.HostelDialog),
);
const RoomDialog = dynamic(() =>
  import("./hostel-dialogs").then((m) => m.RoomDialog),
);

export function HostelView({
  hostels,
  rooms,
  conflicts,
  feeHeads,
  staff,
  canManage,
  canAllocate,
}: {
  hostels: HostelRow[];
  rooms: RoomRow[];
  conflicts: string[];
  feeHeads: { id: string; label: string }[];
  staff: { id: string; label: string }[];
  canManage: boolean;
  canAllocate: boolean;
}) {
  const [hostelOpen, setHostelOpen] = useState(false);
  const [editingHostel, setEditingHostel] = useState<HostelRow | null>(null);
  const [roomOpen, setRoomOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomRow | null>(null);
  const [roomHostelId, setRoomHostelId] = useState<string>("");

  return (
    <div className="flex flex-col gap-4">
      {conflicts.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Some families would be billed twice</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 flex list-disc flex-col gap-1 ps-4">
              {conflicts.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="rooms">
        <TabsList>
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          <TabsTrigger value="houses">Houses</TabsTrigger>
          {canAllocate && (
            <TabsTrigger value="place">Place a child</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="rooms" className="mt-4">
          <RoomsTab
            rooms={rooms}
            hostels={hostels}
            canManage={canManage}
            onAdd={(hostelId) => {
              setEditingRoom(null);
              setRoomHostelId(hostelId);
              setRoomOpen(true);
            }}
            onEdit={(room) => {
              setEditingRoom(room);
              setRoomHostelId(room.hostelId);
              setRoomOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="houses" className="mt-4">
          <HousesTab
            hostels={hostels}
            canManage={canManage}
            onAdd={() => {
              setEditingHostel(null);
              setHostelOpen(true);
            }}
            onEdit={(hostel) => {
              setEditingHostel(hostel);
              setHostelOpen(true);
            }}
          />
        </TabsContent>

        {canAllocate && (
          <TabsContent value="place" className="mt-4">
            <AllocateCard rooms={rooms} />
          </TabsContent>
        )}
      </Tabs>

      {hostelOpen ? (
        <HostelDialog
          open={hostelOpen}
          onOpenChange={setHostelOpen}
          hostel={editingHostel}
          feeHeads={feeHeads}
          staff={staff}
        />
      ) : null}
      {roomOpen ? (
        <RoomDialog
          open={roomOpen}
          onOpenChange={setRoomOpen}
          hostelId={roomHostelId}
          room={editingRoom}
        />
      ) : null}
    </div>
  );
}

function RoomsTab({
  rooms,
  hostels,
  canManage,
  onAdd,
  onEdit,
}: {
  rooms: RoomRow[];
  hostels: HostelRow[];
  canManage: boolean;
  onAdd: (hostelId: string) => void;
  onEdit: (room: RoomRow) => void;
}) {
  const { t, formatCurrency } = useI18n();
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Rooms</CardTitle>
          <CardDescription className="max-w-2xl">
            Beds are the capacity and the fare is per child, so two children
            sharing a double each pay the double rate. A school charging one
            rate sets the same number on every room.
          </CardDescription>
        </div>
        {canManage && hostels.length > 0 && (
          <Button
            size="sm"
            className="cursor-pointer"
            onClick={() => onAdd(hostels[0].id)}
          >
            <Plus className="size-4" aria-hidden="true" />
            New room
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {rooms.length === 0 ? (
          <EmptyState
            icon={
              <BedDouble
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            }
            title="No rooms yet"
            body="Add a boarding house first, then its rooms — each with its bed count and monthly fare."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>House</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Floor</TableHead>
                  <TableHead>Beds</TableHead>
                  <TableHead className="text-end">Monthly fare</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && (
                    <TableHead className="w-16 text-end">Edit</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.map((room) => {
                  const tone = occupancyTone(room.beds, room.occupied);
                  return (
                    <TableRow key={room.roomId}>
                      <TableCell>
                        <Link
                          href={`/hostel/${room.hostelId}`}
                          className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {room.hostelName}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {hostelKindLabel(room.hostelKind, t)}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono font-medium">
                        {room.roomNumber}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {room.floor ?? "—"}
                      </TableCell>
                      <TableCell>
                        {/* Text carries the meaning; the variant only echoes it. */}
                        <Badge
                          variant={
                            tone === "full"
                              ? "destructive"
                              : tone === "warn"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {bedsSentence(room.beds, room.occupied)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end font-mono tabular-nums">
                        {room.monthlyFare > 0
                          ? formatCurrency(room.monthlyFare)
                          : "Free"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={room.isActive ? "outline" : "secondary"}
                        >
                          {room.isActive ? "In use" : "Out of use"}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="cursor-pointer"
                            onClick={() => onEdit(room)}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            <span className="sr-only">
                              Edit room {room.roomNumber}
                            </span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HousesTab({
  hostels,
  canManage,
  onAdd,
  onEdit,
}: {
  hostels: HostelRow[];
  canManage: boolean;
  onAdd: () => void;
  onEdit: (hostel: HostelRow) => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Boarding houses</CardTitle>
          <CardDescription className="max-w-2xl">
            A house that takes only boys or only girls enforces it when a child
            is placed. A mixed house is a real answer, not a fallback.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" className="cursor-pointer" onClick={onAdd}>
            <Plus className="size-4" aria-hidden="true" />
            New house
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {hostels.length === 0 ? (
          <EmptyState
            icon={
              <Building2
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            }
            title="No boarding houses"
            body="Add one, give it rooms with fares, and children can be placed in them."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>House</TableHead>
                  <TableHead>Takes</TableHead>
                  <TableHead>Warden</TableHead>
                  <TableHead className="text-end">Rooms</TableHead>
                  <TableHead>Beds</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && (
                    <TableHead className="w-16 text-end">Edit</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {hostels.map((hostel) => (
                  <TableRow key={hostel.id}>
                    <TableCell>
                      <Link
                        href={`/hostel/${hostel.id}`}
                        className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {hostel.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {hostelKindLabel(hostel.kind, t)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {hostel.wardenName ?? "Not recorded"}
                    </TableCell>
                    <TableCell className="text-end font-mono tabular-nums">
                      {hostel.roomCount}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {hostel.occupied} / {hostel.beds}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={hostel.isActive ? "outline" : "secondary"}
                      >
                        {hostel.isActive ? "Open" : "Closed"}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="cursor-pointer"
                          onClick={() => onEdit(hostel)}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                          <span className="sr-only">Edit {hostel.name}</span>
                        </Button>
                      </TableCell>
                    )}
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

function AllocateCard({ rooms }: { rooms: RoomRow[] }) {
  const { formatCurrency } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [student, setStudent] = useState<BoarderHit | null>(null);
  const [roomId, setRoomId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["hostel-student-search", debounced],
    queryFn: () => searchStudentsForHostel(debounced),
    enabled: debounced.trim().length >= 2,
  });

  const chosen = rooms.find((r) => r.roomId === roomId) ?? null;

  // The gender rule mirrored from `hostel_allocate`, so a clerk is told before
  // choosing rather than after submitting. The database is still the gate.
  const genderClash =
    chosen && student
      ? !genderAllowed(chosen.hostelKind, student.gender)
      : false;
  const full = chosen ? chosen.bedsFree <= 0 : false;

  function submit() {
    setError(null);
    if (!student) return setError("Choose a child first.");
    if (!roomId) return setError("Choose a room.");

    startTransition(async () => {
      const result = await allocateStudent({
        studentId: student.studentId,
        roomId,
        startsOn: startsOn || undefined,
        endsOn: undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        `${student.fullName} is in ${chosen?.hostelName} ${chosen?.roomNumber}.`,
      );
      setStudent(null);
      setTerm("");
      setDebounced("");
      setRoomId("");
      setStartsOn("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Place a child</CardTitle>
        <CardDescription className="max-w-2xl">
          The fare comes from the room and is copied onto the stay, so revising
          a room&apos;s rate later does not restate a bill already raised.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="boarder-search">Child</Label>
          {student ? (
            <div className="flex items-start justify-between gap-2 rounded-md border border-border p-3">
              <div>
                <p className="font-medium">{student.fullName}</p>
                <p className="text-xs text-muted-foreground">
                  {student.admissionNumber ?? "No admission number"}
                  {student.sectionLabel ? ` · ${student.sectionLabel}` : ""}
                  {student.gender
                    ? ` · ${student.gender}`
                    : " · gender not recorded"}
                </p>
                {student.currentRoom && (
                  <p className="mt-1 text-xs font-medium text-[color:var(--color-accent)]">
                    Already in {student.currentRoom}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="cursor-pointer"
                onClick={() => setStudent(null)}
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">Choose a different child</span>
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="boarder-search"
                  className="ps-8"
                  placeholder="Name or admission number"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <p aria-live="polite" className="text-xs text-muted-foreground">
                {isFetching
                  ? "Searching…"
                  : debounced.trim().length >= 2 && hits.length === 0
                    ? "Nobody matches that."
                    : " "}
              </p>
              {hits.length > 0 && (
                <ul className="flex max-h-64 flex-col overflow-y-auto rounded-md border border-border">
                  {hits.map((hit) => (
                    <li key={hit.studentId}>
                      <button
                        type="button"
                        onClick={() => setStudent(hit)}
                        className="flex w-full cursor-pointer flex-col items-start gap-0.5 border-b border-border p-2 text-start transition-colors duration-200 last:border-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="text-sm font-medium">
                          {hit.fullName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {hit.admissionNumber ?? "—"}
                          {hit.sectionLabel ? ` · ${hit.sectionLabel}` : ""}
                          {hit.currentRoom
                            ? ` · already in ${hit.currentRoom}`
                            : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="allocation-room">Room</Label>
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger id="allocation-room" className="cursor-pointer">
              <SelectValue placeholder="Choose a room" />
            </SelectTrigger>
            <SelectContent>
              {rooms
                .filter((r) => r.isActive)
                .map((r) => (
                  <SelectItem
                    key={r.roomId}
                    value={r.roomId}
                    className="cursor-pointer"
                  >
                    {r.hostelName} {r.roomNumber} —{" "}
                    {formatCurrency(r.monthlyFare)}
                    {r.bedsFree <= 0 ? " (full)" : ` (${r.bedsFree} free)`}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {genderClash && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {chosen?.hostelName} is a {chosen?.hostelKind} house, so this
              child cannot be placed there.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="allocation-starts">Starting</Label>
          <Input
            id="allocation-starts"
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank for today.
          </p>
        </div>

        <p aria-live="assertive" className="min-h-5">
          {error && (
            <span role="alert" className="text-sm font-medium text-destructive">
              {error}
            </span>
          )}
        </p>

        <div>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || full || genderClash}
            className="cursor-pointer"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="size-4" aria-hidden="true" />
            )}
            {full ? "That room is full" : "Place"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <span className="rounded-full bg-muted p-3">{icon}</span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
