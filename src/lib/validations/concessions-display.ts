import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

/**
 * The half of `concessions.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `concessions.ts` re-exports all of it.
 */

export const CONCESSION_KINDS = ["percentage", "amount"] as const;

export type ConcessionKind = (typeof CONCESSION_KINDS)[number];

export const KIND_LABEL: Record<ConcessionKind, string> = {
  percentage: "Percentage",
  amount: "Fixed amount",
};

export function kindLabel(kind: string, t: Translator): string {
  const fallback = KIND_LABEL[kind as ConcessionKind];
  return fallback ? labelFor(`concession.kind.${kind}`, fallback, t) : kind;
}

export function statusLabel(status: string, t: Translator): string {
  // A revoked award keeps its credits -- rule 12's "end, do not cancel" -- so
  // the word is "withdrawn", not "deleted", in every language.
  return status === "revoked" ? t("concession.status.revoked") : t("concession.status.active");
}

/** Never colour alone — the label is always beside it. */
export function statusTone(status: string): "success" | "secondary" {
  return status === "revoked" ? "secondary" : "success";
}

/**
 * How a concession reads on a screen. A percentage with a ceiling is the shape
 * schools actually use — *"20%, up to 2,000"* — and showing only the 20% is how
 * a bursar comes to expect a number the system will never credit.
 */
export function concessionSentence(c: {
  kind: string;
  value: number;
  maxAmount?: number | null;
}): string {
  if (c.kind === "percentage") {
    const base = `${trimZeros(c.value)}%`;
    return c.maxAmount ? `${base}, up to ${trimZeros(c.maxAmount)}` : base;
  }
  return trimZeros(c.value);
}

function trimZeros(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "");
}
