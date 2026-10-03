import { cookies } from "next/headers";
import { DEFAULT_PALETTE, PALETTE_COOKIE, isPalette, type PaletteId } from "./palettes";

/** The reader's chosen palette, from their cookie; the default otherwise. */
export async function getPalette(): Promise<PaletteId> {
  const value = (await cookies()).get(PALETTE_COOKIE)?.value;
  return isPalette(value) ? value : DEFAULT_PALETTE;
}
