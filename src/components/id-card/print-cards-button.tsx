"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/providers/i18n-provider";

/**
 * `window.print()` needs a click handler, so this is the only client component
 * in the module — the cards themselves are Server Components and ship no JS.
 *
 * The label is a key rather than `Print ${n} card${n === 1 ? "" : "s"}`, which
 * is what the report-card button still does: an English plural spelled at a
 * call site is rule 15's *"put every count-dependent word in one place"*, and
 * `t.plural` is the place.
 */
export function PrintCardsButton({ count }: { count: number }) {
  const { t } = useI18n();
  if (count === 0) return null;

  return (
    <Button type="button" onClick={() => window.print()} className="cursor-pointer">
      <Printer className="size-4" aria-hidden="true" />
      {count === 1 ? t("idCard.printOne") : t("idCard.print")}
    </Button>
  );
}
