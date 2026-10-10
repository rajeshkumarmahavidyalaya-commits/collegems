# Public website

The college's front door: Home, About, Programmes (and one page per
programme), Admissions, Facilities, Contact. It lives in `src/app/(site)` and
is the only part of the product written for somebody with no account.

## Where it sits

- **`/` is two pages.** Signed in, it is the dashboard. Signed out, the
  middleware *rewrites* it to `/home`, so the address stays the college's front
  door and nobody is bounced to a login form.
- **Its own public list.** `SITE_PUBLIC_PATHS` in `src/middleware.ts`, built from
  `SITE_PATHS` in `lib/site/content.ts`, so a page cannot be added to the site
  and left behind the login. It is deliberately not five more entries in
  `PUBLIC_PATHS`: that list's guard says nothing *application* was made public
  with the admission form, and this surface reads no tenant and no table.
- **Calls into the product, never the other way.** *Apply now* goes to
  `/apply/rajesh-kumar-mahavidyalaya` (migration 0268, off by default per
  college) and *Portal login* to `/login`.

## Content is one file

`src/lib/site/content.ts` holds every fact. No page types a figure of its own.
It was assembled from public directory listings because the college has no site
of its own to read; **where the listings disagreed, the file says so**, and an
unknown fact is `null` so the page draws nothing rather than a guess.

Have the principal's office confirm before launch:

| Item | State |
|---|---|
| PIN code | `222132` (Careers360) vs `222001` (CollegeBatch, the district code) |
| Phone | `05452-261186`, one directory |
| Email, website, office hours | unknown, not shown |
| Principal / leadership | unknown. A director is named in two listings with two different titles, so nobody is named |
| Fees, dates, seats (except B.Ed. 100) | not published; pages say to call |
| Durations | national norms (UGC / NCTE), not quoted from a listing |
| News | `UPDATES` is empty on purpose |
| Photographs | none supplied, so none shown |

## Guards

`tests/site/public-site.test.ts` runs without a database: every advertised
address has a page, the middleware reads the same list, no route collides with
`(app)`, nothing under the site reads Supabase, no hex colours, logical
utilities only. `tests/app-shell/route-boundaries.test.ts` now accepts a
`notFound()` caller outside `(app)` when a segment above it has its own
`not-found.tsx`, which is the second remedy its own message already offered.

## Not built

Faculty and leadership pages, gallery, notices archive, an enquiry form, a
sitemap, and translation (the site is English-only; the ERP's catalogue
machinery is untouched). Each needs content from the college first.
