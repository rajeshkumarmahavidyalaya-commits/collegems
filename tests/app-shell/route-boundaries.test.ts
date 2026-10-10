import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { hi } from "@/lib/i18n/messages/hi";
import { ur } from "@/lib/i18n/messages/ur";

/**
 * Every route now has a floor under it, and the 404 must not answer a question.
 *
 * Measured before building: **86 of the 88 pages are `export default async
 * function`**, awaiting Supabase before returning an element; **no file in
 * `src/app` used `<Suspense>`**; and exactly one route group — `/notifications`
 * — had a `loading.tsx` or an `error.tsx`. There was **no `not-found.tsx`
 * anywhere**, while twenty-one dynamic routes call `notFound()`.
 *
 * So a stale bookmark to a deleted student ejected somebody from the product
 * onto Next's built-in page: no shell, no navigation, no theme, no way back.
 * A failed query did the same. And a slow one left the *previous* page on
 * screen with nothing moving, which does not read as loading — it reads as a
 * click that did not register.
 *
 * This guard runs without a database.
 */

const APP = join(process.cwd(), "src/app");
const GROUP = join(APP, "(app)");

/**
 * Comments out, before anything reads the source.
 *
 * The first draft of the `global-error` check below failed on `global-error.tsx`
 * itself — because that file's own doc comment *explains* that `useI18n` must
 * not be used there, and the check matched the explanation. The operator
 * boundary guard learned the same thing from the other side, where a `--`
 * disarmed it: **a guard that reads prose reports on the prose.** Strip first,
 * then match.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) tsxFiles(p, acc);
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

describe("every route has a boundary under it", () => {
  it("has the four the app needs, each where it can actually catch", () => {
    // Nested boundaries win, so the group-level pair is the floor and a route
    // with a shape worth matching (the inbox) keeps its own.
    expect(existsSync(join(GROUP, "loading.tsx")), "(app)/loading.tsx").toBe(true);
    expect(existsSync(join(GROUP, "error.tsx")), "(app)/error.tsx").toBe(true);
    expect(existsSync(join(GROUP, "not-found.tsx")), "(app)/not-found.tsx").toBe(true);
    // Outside the group: a URL matching no route at all.
    expect(existsSync(join(APP, "not-found.tsx")), "app/not-found.tsx").toBe(true);
    // And the root layout's own failure, which nothing else can catch.
    expect(existsSync(join(APP, "global-error.tsx")), "app/global-error.tsx").toBe(true);
  });

  it("keeps every notFound() caller inside the group that has the boundary", () => {
    // A `notFound()` thrown from a route outside `(app)` would fall through to
    // the root page, which has no shell — so the boundary would exist and not
    // cover the thing it was built for.
    const strays = tsxFiles(APP)
      .filter((f) => /\bnotFound\(\)/.test(withoutComments(readFileSync(f, "utf8"))))
      .filter((f) => !f.startsWith(GROUP))
      .map((f) => f.replace(APP, "src/app"));

    expect(
      strays,
      "These throw notFound() from outside (app), where the designed 404 does " +
        "not reach them. Either move the route into the group or give its own " +
        "segment a not-found.tsx.",
    ).toEqual([]);
  });

  it("does not tell a stranger whether the row exists", () => {
    // **The security property, and the reason this copy is bland.**
    //
    // All twenty-one callers are `.eq("id", id).maybeSingle()` then
    // `if (!row) notFound()`. Under RLS, *"there is no such row"* and *"that row
    // is not yours"* are the same answer — the policy returns nothing either
    // way, and the page could not distinguish them if it tried.
    //
    // So the 404 must not claim absence. "That student does not exist" would be
    // wrong half the time, and it would turn the page into an oracle: iterate
    // over ids, and the message that comes back says which ones are real. The
    // platform console makes this argument about its own refusal — *"a message
    // that distinguished them would be a way of asking which addresses are
    // operator accounts"* — and this is the same sentence one layer down.
    const CLAIMS_ABSENCE = [
      /does not exist/i,
      /doesn'?t exist/i,
      /no such/i,
      /was deleted/i,
      /has been deleted/i,
      /not found in/i,
      /never existed/i,
    ];

    for (const [locale, catalogue] of [
      ["en", en],
      ["hi", hi],
      ["ur", ur],
    ] as const) {
      const copy = [
        (catalogue as Record<string, string>)["boundary.notFound.title"],
        (catalogue as Record<string, string>)["boundary.notFound.body"],
      ]
        .filter(Boolean)
        .join(" ");

      // English is the source catalogue, so its two keys must exist; a
      // translation may legitimately not have them yet.
      if (locale === "en") expect(copy.length, "English 404 copy").toBeGreaterThan(20);

      for (const claim of CLAIMS_ABSENCE) {
        expect(
          claim.test(copy),
          `The ${locale} 404 copy asserts the record is gone (${claim}). Under RLS ` +
            `the page cannot know that: "missing" and "not yours" are one answer. ` +
            `Saying which is both wrong half the time and a way of asking.`,
        ).toBe(false);
      }
    }
  });

  it("keeps global-error free of the providers it renders without", () => {
    // `global-error.tsx` replaces the root layout, so `I18nProvider`,
    // `ThemeProvider` and `QueryProvider` are not mounted. A hook from any of
    // them throws — and it throws *inside the boundary that exists to catch a
    // throw*, which is a blank page rather than an error message.
    //
    // This is why that file is the one screen deliberately left untranslated,
    // and this is what stops somebody "fixing" that.
    const src = withoutComments(readFileSync(join(APP, "global-error.tsx"), "utf8"));
    for (const forbidden of ["useI18n", "useTheme", "useQuery", "getT(", "next/font"]) {
      expect(
        src.includes(forbidden),
        `global-error.tsx must not use ${forbidden}: the provider it comes from is ` +
          `not mounted when this renders, so it would throw inside the last boundary.`,
      ).toBe(false);
    }
    // It has to bring its own document, because it replaces the one that failed.
    expect(src).toMatch(/<html/);
    expect(src).toMatch(/<body/);
  });

  it("gives the error boundaries a digest and a way out", () => {
    // A digest is the only thing connecting what somebody saw to a line in the
    // server log; a reset is the difference between an error page and a dead
    // end. Both boundaries, checked rather than assumed.
    for (const file of [join(GROUP, "error.tsx"), join(APP, "global-error.tsx")]) {
      const src = withoutComments(readFileSync(file, "utf8"));
      expect(src, `${file} should show the digest`).toMatch(/error\.digest/);
      expect(src, `${file} should offer reset()`).toMatch(/onClick=\{reset\}/);
    }
  });
});
