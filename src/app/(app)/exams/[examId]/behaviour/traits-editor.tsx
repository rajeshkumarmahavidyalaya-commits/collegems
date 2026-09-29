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
import { useI18n } from "@/components/providers/i18n-provider";
import { addTrait, setTraitActive, type BehaviourTrait } from "../../behaviour-actions";

/**
 * The college's list of what it grades (0303). Rule 12: a school that grades
 * yoga and not art edits this list rather than waiting for a release. A trait
 * is retired, never deleted, so a card from last term still prints it.
 */
export function TraitsEditor({ traits }: { traits: BehaviourTrait[] }) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("behaviour");

  function add() {
    startTransition(async () => {
      const result = await addTrait({ name, kind });
      if (result.ok) {
        toast.success(t("behaviour.added", { name: name.trim() }));
        setName("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function toggle(trait: BehaviourTrait) {
    startTransition(async () => {
      const result = await setTraitActive(trait.id, !trait.isActive);
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-2">
        {traits.map((trait) => (
          <li key={trait.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() => toggle(trait)}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={trait.isActive ? t("behaviour.retire", { name: trait.name }) : t("behaviour.restore", { name: trait.name })}
              title={trait.isActive ? t("behaviour.retireHint") : t("behaviour.restoreHint")}
            >
              <Badge variant={trait.isActive ? "secondary" : "outline"} className={trait.isActive ? "" : "line-through"}>
                {trait.name} · {trait.kind === "skill" ? t("behaviour.kind.skill") : t("behaviour.kind.behaviour")}
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
          <Label htmlFor="trait-name">{t("behaviour.newTrait")}</Label>
          <Input
            id="trait-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("behaviour.newTraitPlaceholder")}
            maxLength={80}
            className="w-56"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trait-kind">{t("behaviour.kind")}</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger id="trait-kind" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="behaviour">{t("behaviour.kind.behaviour")}</SelectItem>
              <SelectItem value="skill">{t("behaviour.kind.skill")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="outline" disabled={pending || name.trim().length === 0}>
          <Plus className="size-4" aria-hidden="true" />
          {t("behaviour.add")}
        </Button>
      </form>
    </div>
  );
}
