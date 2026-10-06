import { getUserContext } from "@/lib/auth/context";
import { getLocale } from "@/lib/i18n/server";
import { pickChild } from "./actions";

/**
 * What every family page starts from: whether this login is a family's (the
 * tier, which decides only what is shown, 0208), its children, and the one the
 * page is about.
 */
export async function loadFamilyPage(requested?: string | null) {
  const [ctx, locale, picked] = await Promise.all([getUserContext(), getLocale(), pickChild(requested)]);
  return {
    ctx,
    locale,
    isFamily: ctx?.roleTier === "student",
    childList: picked.children,
    child: picked.child,
  };
}
