"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { startSchoolSchema } from "@/lib/validations/platform";

export type StartActionState = {
  error: string | null;
  fieldErrors?: Record<string, string[]>;
};

/** Is this address free? Used by the form as somebody types, never as the gate. */
export async function checkSlug(slug: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_slug_available", { p_slug: slug });
  // On error, say "taken". A false "available" leads somebody through a whole
  // form to a refusal at the end; a false "taken" costs them one edit.
  if (error) return false;
  return data === true;
}

export async function startSchool(
  _prevState: StartActionState,
  formData: FormData,
): Promise<StartActionState> {
  const parsed = startSchoolSchema.safeParse({
    schoolName: formData.get("schoolName"),
    slug: formData.get("slug"),
    timezone: formData.get("timezone") || "Asia/Kolkata",
    sessionName: formData.get("sessionName") || undefined,
    sessionStart: formData.get("sessionStart") || undefined,
    sessionEnd: formData.get("sessionEnd") || undefined,
  });

  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_start_school", {
    p_school_name: parsed.data.schoolName,
    p_slug: parsed.data.slug,
    p_timezone: parsed.data.timezone,
    p_session_name: parsed.data.sessionName || undefined,
    p_session_start: parsed.data.sessionStart || undefined,
    p_session_end: parsed.data.sessionEnd || undefined,
  });

  if (error) {
    // The function raises sentences, not codes — "The address x.schoolos.app is
    // already taken." — so the message is shown as written rather than mapped
    // to something vaguer.
    return { error: error.message };
  }

  // The JWT was minted before the tenant existed, so it still says this person
  // belongs to nobody. Every RLS policy reads the tenant from that claim, which
  // means without this refresh the freshly-created school is invisible to the
  // person who just created it — an empty dashboard that looks like a failure.
  await supabase.auth.refreshSession();

  redirect("/");
}
