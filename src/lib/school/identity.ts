import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";

/**
 * Who the school is, for the top of anything it prints.
 *
 * One reader of `school.profile`, because there were two within a week of each
 * other: the student card sheet and the staff card sheet each resolved the same
 * setting into the same three fields, identical but for a comment. That is the
 * `formatMoney`-under-four-names shape CLAUDE.md already names —
 *
 * > *copies that agree cost nothing until the day one of them has to change*
 *
 * — and the day was already scheduled: the ID-card module's own *Not built*
 * list wants a card back carrying the school's rules and an emergency number,
 * which is a third read of the same setting.
 *
 * It lives at the top level rather than under either card module because
 * `school.profile` is not an ID-card concept: the invoice document (`0030`) and
 * the certificate engine (`0133`) already read it in SQL. This is the
 * TypeScript reader of the same thing.
 *
 * **Nothing here is a gate.** `settings` is readable by every member of the
 * school by design — rule 12 is explicit that nothing secret may live there,
 * which is exactly why it is safe to print on a card a child carries.
 */

type ProfileRow = {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
};

export type SchoolIdentity = {
  name: string;
  /** The address as one line, or null when the school has not filled it in. */
  addressLine: string | null;
  phone: string | null;
  /**
   * The academic year, resolved server-side (rule 2) and never taken from a
   * caller. A document about *now* has to carry the now it was true of, or it
   * is a card with no expiry that a fifteen-year-old is still holding at twenty.
   */
  sessionName: string | null;
};

export async function schoolIdentity(): Promise<SchoolIdentity> {
  const [ctx, supabase] = await Promise.all([getUserContext(), createClient()]);
  const { data } = await supabase.rpc("setting_value", { p_key: "school.profile" });
  const profile = (data ?? {}) as ProfileRow;

  const addressLine =
    [profile.address_line1, profile.address_line2, profile.city, profile.state, profile.postal_code]
      .map((part) => (part ?? "").trim())
      .filter(Boolean)
      .join(", ") || null;

  return {
    name: ctx?.tenantName ?? "",
    addressLine,
    phone: profile.phone?.trim() || null,
    sessionName: ctx?.currentSessionName ?? null,
  };
}
