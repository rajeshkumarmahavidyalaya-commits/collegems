"use server";

import { createClient } from "@/lib/supabase/server";
import { parseAssistantReply, type AssistantReply, type AssistantTurn } from "@/lib/validations/assistant";
import type { ActionResult } from "../library/actions";

/**
 * Ask the assistant (migration 0283). The question travels to the `assistant`
 * Edge Function with the signed-in person's own token -- `functions.invoke`
 * on the server client attaches it -- and every read the function makes is
 * made with that token. Nothing here holds a key or reads data itself.
 */
export async function askAssistant(turns: AssistantTurn[]): Promise<ActionResult<AssistantReply>> {
  const clean = (Array.isArray(turns) ? turns : [])
    .filter(
      (t) =>
        (t?.role === "user" || t?.role === "model") &&
        typeof t.text === "string" &&
        t.text.trim().length > 0,
    )
    .slice(-12)
    .map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }));

  if (!clean.length || clean[clean.length - 1].role !== "user") {
    return { ok: false, error: "Type a question first." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("assistant", { body: { turns: clean } });

  if (error) {
    // A refusal from the function is a sentence meant for the person -- the
    // daily limit, an unconfigured key -- so read it back rather than showing
    // "Edge Function returned a non-2xx status code".
    let message = "The assistant could not answer just now. Please try again in a minute.";
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = (await context.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // Not JSON: keep the general sentence.
      }
    }
    return { ok: false, error: message };
  }

  return { ok: true, data: parseAssistantReply(data) };
}
