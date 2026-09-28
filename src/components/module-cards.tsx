import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MODULE_CARDS, parseModuleCards } from "@/lib/validations/modules";
import { cn } from "@/lib/utils";

/**
 * The strip of counts at the top of a module page (0294, 0295) -- the same
 * shape on every module, so a person who has learned one page has learned
 * them all.
 *
 * A Server Component with no client code: the numbers are read as the
 * caller, through `module_cards()`, gated in SQL like the module's home tile.
 * There is no role list and no `hasPermission` here (rule 4): a card the
 * caller may not see is a card the function did not return. When it returns
 * nothing, the strip draws nothing -- the list below is still the page.
 */
export async function ModuleCards({ module }: { module: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("module_cards", { p_module: module });
  if (error) return null;
  const cards = parseModuleCards(module, data);
  if (cards.length === 0) return null;

  return (
    <ul
      aria-label="At a glance"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
    >
      {cards.map((c) => {
        const card = MODULE_CARDS[module][c.key];
        const alert = card.warn === true && c.count > 0;
        const body = (
          <>
            <span
              className={cn(
                "font-mono text-2xl font-semibold tabular-nums",
                alert && "text-warning",
              )}
            >
              {c.count}
            </span>
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              {card.label}
              {card.href && <ArrowUpRight className="size-3.5" aria-hidden="true" />}
            </span>
          </>
        );
        const box =
          "flex flex-col gap-1 rounded-xl border border-border bg-card p-4";
        return (
          <li key={c.key}>
            {card.href ? (
              <Link
                href={card.href}
                className={cn(
                  box,
                  "transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {body}
              </Link>
            ) : (
              <div className={box}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
