"use server";

import { createClient } from "@/lib/supabase/server";
import { groupChecks, type CheckGroup } from "@/lib/validations/checks";

/**
 * Every critic the caller is allowed to see, in one call.
 *
 * No permission gate here on purpose: `checks_run()` gates each check on the
 * matrix itself and returns `withheld` for the ones it did not run, so a page
 * that pre-filtered would be a second answer to a question the server already
 * answers — and a worse one, because it could not tell "your role does not see
 * this" from "there is nothing to see".
 */
export async function listChecks(): Promise<CheckGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checks_run");
  if (error) throw new Error(error.message);
  return groupChecks(data ?? []);
}
