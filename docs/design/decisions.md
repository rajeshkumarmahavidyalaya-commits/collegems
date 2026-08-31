# Design decisions

The palette, type scale and spacing came from the ui-ux-pro-max skill, run
against this brief:

> education management ERP dashboard for schools, admin analytics, data-dense
> tables, trustworthy institutional software

with the dials set to **variance 3** (centred/minimal), **motion 3** (subtle),
**density 8** (dashboard-dense). Raw output lives in
`design-system/schoolos/MASTER.md`; per-page overrides in
`design-system/schoolos/pages/`. Tokens are implemented as CSS variables in
`src/app/globals.css`.

This file records *why* each value survived, and — more importantly — the four
places the generated system was overridden and what the reasoning was.

---

## Colour

| Role | Light | Dark | Why |
|---|---|---|---|
| `--primary` | `#1E40AF` | `#7DA2FF` | Deep institutional blue. Reads as school/civic/bank, not startup. The dark variant is a lighter, desaturated tonal variant with dark text on top, per the skill's `color-dark-mode` rule — not an inversion. |
| `--brand-accent` | `#D97706` | `#FBBF24` | Amber, for emphasis only (see override 2). Adjusted by the skill from `#F59E0B` for contrast. |
| `--background` | `#F8FAFC` | `#0B1220` | Near-white with a blue cast; dark is deep navy rather than black, which is easier on eyes over a 6-hour shift and keeps the blue family coherent. |
| `--foreground` | `#1E3A8A` | `#E5EDFB` | Blue-tinted text rather than neutral grey — a small thing that makes the whole product feel deliberate rather than default-Bootstrap. Comfortably above 4.5:1 on its background. |
| `--muted-foreground` | `#475569` | `#93A4C3` | Secondary text. Still ≥4.5:1 — "muted" must not mean "fails contrast", which is the single most common dashboard accessibility failure. |
| `--border` | `#DBEAFE` | `#26324B` | Blue-tinted hairlines. Defined per theme so dividers stay visible in dark mode. |
| `--destructive` | `#DC2626` | `#EF4444` | Red-600 / red-500. Lightened in dark mode so it reads against a navy surface. |
| `--success` / `--warning` | `#15803D` / `#B45309` | `#4ADE80` / `#FBBF24` | Added beyond the generated set — status badges need semantic colours, and reusing `destructive` for "overdue" would overstate it. |
| `--chart-1…5` | blue, amber, teal, violet, slate | lightened equivalents | Five hues distinguishable without relying on hue alone; charts also carry direct labels and legends. |

**Colour is never the only signal.** Overdue rows carry the word "Overdue" in
the badge, not just red. This is a rule in CLAUDE.md, not a preference.

## Typography

- **Fira Sans** for everything readable — UI, headings, body.
- **Fira Code** for numerics and identifiers: fees, marks, admission numbers,
  membership numbers, ISBNs, copy counts, dates in tables.

Loaded through `next/font/google` (self-hosted, `display: swap`) rather than an
`@import`, so there is no render-blocking request and no FOIT.

The `tabular-nums` utility is applied to every numeric column so digits stay
column-aligned and rows don't jitter as values change.

## Spacing, radius, shadow, motion

- Density 8/10 gives a tight scale (2 / 4 / 8 / 12 / 16 / 24 / 32px). Correct
  for a product where a user wants 25 rows on screen, not 8.
- `--radius: 0.5rem` (8px), matching the generated component spec. Geometric
  and calm; not pill-shaped.
- Shadows are minimal — borders do most of the separation work, which suits
  the Swiss/minimalist direction and keeps dense tables from looking fuzzy.
- Motion is subtle by design and globally disabled under
  `prefers-reduced-motion` in `globals.css`.

---

## Overrides — where the generated system was not followed

### 1. Fira Code is not the heading font

The skill returned "Fira Code / Fira Sans" with Fira Code as the display face.
A monospace heading font reads as *developer tool*, and this product is meant
to feel like institutional software a principal trusts with children's data
and fee money. Fira Sans carries all headings; Fira Code is reassigned to
tabular figures and identifiers — which is what the skill's own
`number-tabular` guideline asks for anyway. Same font pairing, better job
allocation.

### 2. Amber is emphasis, not shadcn's `--accent`

The generated palette lists amber as "Accent/CTA". Mapping that straight onto
shadcn's `--accent` token would have tinted every menu hover, selected row and
focus background amber, because that is what `--accent` means in shadcn's
semantics — a subtle interaction tint, not a brand CTA colour.

So the two were separated:

- `--accent` stays a quiet blue-grey hover tint.
- `--brand-accent` holds the amber, used sparingly for genuine emphasis.

The brief asked for restraint over decoration. Amber everywhere would have
been the opposite.

### 3. The "Enterprise Gateway" page pattern was discarded

The skill returned a marketing-landing pattern — hero video, "Solutions by
Industry", client logos, "Contact Sales" CTA. That is a public website
structure. What is being built is the authenticated app behind the login. The
palette, type, spacing, shadow and anti-pattern guidance were kept; the section
ordering was not applicable and was dropped. If a marketing site is built
later, that pattern is the right starting point for *it*.

### 4. Semantic status colours were added

The generated set had no success/warning tokens. Status badges need them, and
overloading `destructive` for "overdue" would have made a routine state look
like an error.

---

## Beating the thing we're replacing

The brief was explicit that eSkooly's UI is the bar to clear. Concretely, what
was done differently:

| eSkooly | SchoolOS |
|---|---|
| Cramped tables, no filtering | Server-side paginated DataTable: sort, search, faceted filters, column visibility, saved views, CSV export |
| No empty states | Every list has designed empty / loading-skeleton / error states with recovery actions |
| Emoji-ish and mixed icon sets | One family, lucide-react, real SVG, zero emoji |
| Light mode only | Light + dark, both meeting 4.5:1, plus `prefers-reduced-motion` |
| No keyboard support | Visible focus rings everywhere, ⌘K command palette across students/staff/books |
| Modal-on-modal | One dialog depth; forms are routed pages with an unsaved-changes guard |
| Mobile = shrunk desktop | Mobile-first shell: drawer nav, tables scroll in their own container, tested 375/768/1024/1440 |
| Colour-only status | Every badge pairs colour with a word |

## Still owed

Honest list of what the design system asks for that is **not** done yet,
because the modules that need it do not exist:

- **Keyboard-first grid editing** (arrow-key navigation, Enter to advance,
  autosave with a save indicator) — specified for marks entry and attendance.
  Page overrides for both exist; the modules do not. The DataTable primitive
  will need an inline-edit mode to support them.
- **Optimistic UI with rollback** — the current mutations are
  server-action-then-refresh. Correct and simple, but the high-volume screens
  (attendance especially) will need optimistic writes.
- **Touch-first attendance flow** — designed for the phone, per the brief. Not
  built.
- **Undo for destructive actions** — deletes are confirmed but not yet
  undoable. The audit log stores the old row, so undo is implementable.
