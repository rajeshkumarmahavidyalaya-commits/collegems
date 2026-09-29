"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addTrait, setTraitActive, type BehaviourTrait } from "../../behaviour-actions";

/**
 * The college's list of what it grades (0303). Rule 12: a school that grades
 * yoga and not art edits this list rather than waiting for a release. A trait
 * is retired, never deleted, so a card from last term still prints it.
 */
export function TraitsEditor({ traits }: { traits: BehaviourTrait[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("behaviour");

  function add() {
    startTransition(async () => {
      const result = await addTrait({ name, kind });
      if (result.ok) {
        toast.success(`"${name.trim()}" added`);
        setName("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function toggle(t: BehaviourTrait) {
    startTransition(async () => {
      const result = await setTraitActive(t.id, !t.isActive);
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-2">
        {traits.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() => toggle(t)}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t.isActive ? `Retire ${t.name}` : `Restore ${t.name}`}
              title={t.isActive ? "Retire: stop grading this" : "Restore"}
            >
              <Badge variant={t.isActive ? "secondary" : "outline"} className={t.isActive ? "" : "line-through"}>
                {t.name} · {t.kind === "skill" ? "skill" : "behaviour"}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trait-name">New trait</Label>
          <Input
            id="trait-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Yoga"
            maxLength={80}
            className="w-56"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trait-kind">Kind</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger id="trait-kind" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="behaviour">Behaviour</SelectItem>
              <SelectItem value="skill">Skill</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="outline" disabled={pending || name.trim().length === 0}>
          <Plus className="size-4" aria-hidden="true" />
          Add
        </Button>
      </form>
    </div>
  );
}
