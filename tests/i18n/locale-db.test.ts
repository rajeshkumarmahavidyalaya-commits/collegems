import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient } from "../helpers/client";
import { LOCALE_CODES } from "@/lib/i18n/config";

/**
 * The database half of the locale, against the real project.
 *
 * Two claims worth a test:
 *
 *   - **A person may set their own language and nothing else.** `user_profiles`
 *     has no self-update policy at all — that is what stops somebody changing
 *     their own `role_id` — so locale goes through a definer function, which is
 *     the "a column grant separates columns, not people" case from CLAUDE.md.
 *     A GRANT would have widened `locale` for administrators too, and left the
 *     policy question untouched.
 *   - **`reference.locales` and the build agree.** A language offered by the
 *     deployment with no catalogue in the bundle would render entirely in
 *     English while claiming to be Urdu.
 */
describe("choosing a language", () => {
  let a: SupabaseClient<Database>;
  let original: string | null = null;

  beforeAll(async () => {
    a = await tenantAClient();
    const { data: user } = await a.auth.getUser();
    const { data } = await a
      .from("user_profiles")
      .select("locale")
      .eq("id", user.user!.id)
      .single();
    original = data?.locale ?? null;
  });

  afterAll(async () => {
    if (a) await a.rpc("set_my_locale", { p_locale: original ?? (undefined as never) });
  });

  it("offers exactly the languages this build has messages for", async () => {
    const { data, error } = await a.rpc("available_locales");
    expect(error).toBeNull();

    const offered = (data ?? []).map((row) => row.code).sort();
    expect(offered).toEqual([...LOCALE_CODES].sort());
  });

  it("says which way each language runs, as data rather than by guessing", async () => {
    const { data } = await a.rpc("available_locales");
    const urdu = (data ?? []).find((row) => row.code === "ur");
    expect(urdu?.direction).toBe("rtl");
    expect((data ?? []).find((row) => row.code === "hi")?.direction).toBe("ltr");
  });

  it("names exactly one default, the school's", async () => {
    const { data } = await a.rpc("available_locales");
    expect((data ?? []).filter((row) => row.is_default)).toHaveLength(1);
  });

  it("lets a person set their own language", async () => {
    const { error } = await a.rpc("set_my_locale", { p_locale: "hi" });
    expect(error).toBeNull();

    const { data: user } = await a.auth.getUser();
    const { data } = await a
      .from("user_profiles")
      .select("locale")
      .eq("id", user.user!.id)
      .single();
    expect(data?.locale).toBe("hi");
  });

  it("refuses a language this system has no messages in", async () => {
    const { error } = await a.rpc("set_my_locale", { p_locale: "de" });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("no messages in");
  });

  it("is the only way in for somebody who is not an administrator", async () => {
    // Stated rather than asserted, because it is not testable with the logins
    // this suite has. Both test accounts are administrators, and the
    // "admins update tenant profiles" policy lets them write any profile in
    // their own school, their own included — so a direct UPDATE here would
    // succeed and prove nothing.
    //
    // What the definer function is actually for is the other four roles: a
    // student or a parent matches no UPDATE policy on `user_profiles` at all,
    // so without `set_my_locale` they could not choose a language. Proving that
    // needs a non-admin login, which the cross-tenant suite does not have.
    const { data, error } = await a.rpc("set_my_locale", { p_locale: "ur" });
    expect(error).toBeNull();
    expect(data).toBe("ur");
  });
});
