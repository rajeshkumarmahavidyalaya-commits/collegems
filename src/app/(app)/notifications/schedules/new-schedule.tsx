"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { saveSchedule } from "./actions";
import {
  KIND_DESCRIPTION,
  KIND_LABEL,
  SCHEDULE_KINDS,
  graceSentence,
  scheduleSentence,
  type ScheduleKind,
} from "@/lib/validations/schedules";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

/**
 * Adding one.
 *
 * The form shows the sentence it is building as it is built — *"Every weekday
 * at 19:30"*, *"Skipped if more than 2 hours late"* — because three fields that
 * a person reads as one fact should be checkable as one fact. The same two
 * functions render it on the card afterwards, so what somebody agreed to and
 * what they see later cannot say different things.
 */
export function NewSchedule() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [kind, setKind] = useState<ScheduleKind>("attendance.absentees");
  const [name, setName] = useState("");
  const [runAt, setRunAt] = useState("19:30");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [monthly, setMonthly] = useState(false);
  const [dayOfMonth, setDayOfMonth] = useState(5);
  const [graceMinutes, setGraceMinutes] = useState(120);
  const [minAmount, setMinAmount] = useState(1);
  const [minDaysOver, setMinDaysOver] = useState(1);

  function toggleDay(day: number) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  function onSave() {
    startTransition(async () => {
      const result = await saveSchedule({
        kind,
        name: name.trim() || KIND_LABEL[kind],
        runAt,
        weekdays: monthly ? [] : weekdays,
        dayOfMonth: monthly ? dayOfMonth : null,
        graceMinutes,
        minAmount: kind === "fees.due_reminder" ? minAmount : null,
        minDaysOver: kind === "library.overdue" ? minDaysOver : null,
        // Off, always. Creating a schedule and having it start sending is the
        // one surprise this module must never spring on a school.
        isEnabled: false,
      });

      if (result.ok) {
        toast.success("Added, and switched off. Turn it on when you are ready.");
        setOpen(false);
        setName("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden="true" />
          Add an automatic message
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add an automatic message</DialogTitle>
          <DialogDescription>
            It is created switched off. Nothing goes out until you turn it on, and turning it on
            never sends the occurrences it missed beforehand.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kind">What to send</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ScheduleKind)}>
              <SelectTrigger id="kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{KIND_DESCRIPTION[kind]}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              placeholder={KIND_LABEL[kind]}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-at">Time</Label>
            <Input
              id="run-at"
              type="time"
              value={runAt}
              onChange={(e) => setRunAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Your school&rsquo;s local time, not the server&rsquo;s.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="monthly"
              checked={monthly}
              onCheckedChange={(v) => setMonthly(v === true)}
            />
            <Label htmlFor="monthly" className="font-normal">
              Once a month instead of on particular days
            </Label>
          </div>

          {monthly ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="day-of-month">Day of the month</Label>
              <Input
                id="day-of-month"
                type="number"
                min={1}
                max={28}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Up to the 28th. Later days silently skip February and the short months, which looks
                broken for five months of the year.
              </p>
            </div>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Days</legend>
              <div className="flex flex-wrap gap-3">
                {DAYS.map((day) => (
                  <div key={day.value} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`day-${day.value}`}
                      checked={weekdays.includes(day.value)}
                      onCheckedChange={() => toggleDay(day.value)}
                    />
                    <Label htmlFor={`day-${day.value}`} className="font-normal">
                      {day.label}
                    </Label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Choose none for every day.</p>
            </fieldset>
          )}

          {kind === "fees.due_reminder" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="min-amount">Only above</Label>
              <Input
                id="min-amount"
                type="number"
                min={0}
                step="0.01"
                value={minAmount}
                onChange={(e) => setMinAmount(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                So a two-rupee rounding difference does not generate a message.
              </p>
            </div>
          )}

          {kind === "library.overdue" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="min-days">Only after</Label>
              <Input
                id="min-days"
                type="number"
                min={1}
                value={minDaysOver}
                onChange={(e) => setMinDaysOver(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Days past the due date.</p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grace">Give up if later than (minutes)</Label>
            <Input
              id="grace"
              type="number"
              min={5}
              max={1440}
              value={graceMinutes}
              onChange={(e) => setGraceMinutes(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              {graceSentence(graceMinutes)}. An absence notice hours late is worse than none — the
              parent has had the child at home all evening. A fee reminder is not.
            </p>
          </div>

          {/* The sentence the card will show, shown now. */}
          <div
            className="rounded-md border bg-muted/40 p-3 text-sm"
            aria-live="polite"
          >
            <strong className="font-medium">
              {scheduleSentence({
                run_at: `${runAt}:00`,
                weekdays: monthly ? [] : weekdays,
                day_of_month: monthly ? dayOfMonth : null,
              })}
            </strong>
            <span className="text-muted-foreground"> · {graceSentence(graceMinutes)}</span>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={onSave} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Add, switched off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
