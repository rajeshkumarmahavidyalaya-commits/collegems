# Public Website Overrides

> **PROJECT:** SchoolOS
> **Page Type:** Marketing / public information (`src/app/(site)`)

> Rules in this file **override** `MASTER.md` for the college's public website only.
> Everything else (tokens, contrast, motion, accessibility) still applies.

## Intent

Minimal, modern, easy to navigate, in the manner of Integral University and
Babu Banarasi Das University: a quiet header, one clear call to action (*Apply
now*), and an information architecture a parent can learn in one visit —
Home, About, Programmes, Admissions, Facilities, Contact, plus *Portal login*.

## Overrides

- **Density:** low. The dashboard's 8/10 density does not apply; sections use
  `py-16 sm:py-20` and cards `p-5`/`p-6`.
- **Type:** headings use `font-serif` (the system serif stack, so nothing is
  downloaded, per the root layout's rule); body stays `font-sans`.
- **Layout:** `max-w-6xl` container, 16 px gutter on phones, 24 px from `sm`.
- **Colour:** tokens only. The hero wash is
  `color-mix(in oklab, var(--primary) 12–14%, transparent)`, so it follows the
  reader's palette and dark mode. No hex, and no photographs that were not supplied.
- **One primary action per view.** *Apply now* is the filled button; every other
  button is outline, ghost or link.
- **Honest content.** A section with nothing to say is not drawn
  (`UPDATES` empty means no news strip) and an unknown contact fact is not printed
  as a dash. See `docs/modules/website.md`.
