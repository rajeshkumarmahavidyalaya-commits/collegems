/**
 * The colour palettes a person may choose on Settings → Appearance. A
 * palette is a set of colour tokens in globals.css under
 * `:root[data-palette="…"]`; nothing in a component carries a colour, so a
 * palette reaches every screen at once.
 *
 * **No imports here**, so the picker (a client component) and the root layout
 * (a server component) share one list without dragging anything else along.
 *
 * A preview of a palette is any element carrying `data-palette` — the CSS
 * matches it there too — so the picker shows real tokens, not copied colours.
 *
 * Every palette was measured before it was written: text on each of its
 * colours is at least 4.5:1 in light and dark mode (globals.css carries the
 * figures). A palette added here must be measured the same way.
 */
export const PALETTES = [
  { id: "indigo" },
  { id: "emerald" },
  { id: "ocean" },
  { id: "berry" },
  { id: "sunset" },
  { id: "classic" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

export const DEFAULT_PALETTE: PaletteId = "indigo";

/** A cookie, so the server renders the chosen colours and nothing flashes. */
export const PALETTE_COOKIE = "schoolos-palette";

export function isPalette(value: unknown): value is PaletteId {
  return typeof value === "string" && PALETTES.some((p) => p.id === value);
}
