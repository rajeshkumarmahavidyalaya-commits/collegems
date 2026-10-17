"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth/context";
import { YEAR_COOKIE } from "@/lib/academic-year";
import type { ActionResult } from "./library/actions";

/**
 * Open a year to read it, or go back to the working year (0355). Only a year
 * of this college is accepted; choosing the working year clears the choice.
 * Nothing about the college changes: the working year is decided on the
 * Academic years screen, and Postgres keeps any other year read-only.
 */
export async function chooseYear(sessionId: string): Promise<ActionResult<{ name: string }>> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Sign in again." };
  const year = ctx.years.find((y) => y.id === sessionId);
  if (!year) return { ok: false, error: "That is not one of this college's years." };

  const jar = await cookies();
  if (year.isCurrent) {
    jar.delete(YEAR_COOKIE);
  } else {
    jar.set(YEAR_COOKIE, year.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // A day: somebody who opened last year on Monday should not find
      // themselves in it on Wednesday without knowing why.
      maxAge: 60 * 60 * 24,
    });
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { name: year.name } };
}
