import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { readCollege, type PublicCollege } from "@/lib/validations/public-pages";

/**
 * The college behind a public page, or null for every reason there is none:
 * an unknown slug, a college switched off, and one with every page closed all
 * look the same (0361). Cached per request, so a page and its shell ask once.
 */
export const loadCollege = cache(async (slug: string): Promise<PublicCollege | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_college", { p_slug: slug });
  if (error) {
    console.error("[college] public_college failed:", error.code, error.message);
    return null;
  }
  return readCollege(data);
});
