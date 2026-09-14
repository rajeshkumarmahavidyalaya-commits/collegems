import { Skeleton } from "@/components/ui/skeleton";

/**
 * The floor, for eighty-six routes that block before they paint.
 *
 * Measured: **86 of the 88 pages are `export default async function`**, every
 * one of them awaiting Supabase before returning a single element, and **not one
 * file in `src/app` uses `<Suspense>`**. Only `/notifications` had a
 * `loading.tsx`. Everywhere else, clicking a nav item left the *previous* page
 * on screen with nothing moving until the query came back — which does not read
 * as loading, it reads as a click that did not register, and the honest response
 * to that is to click again.
 *
 * This is deliberately **shape-neutral** and deliberately the *floor*. It cannot
 * match eighty-six different pages, so it matches what they share: the heading
 * block (`h1` plus one line of description) that twenty-nine of them open with,
 * a toolbar row, and a table. A route whose shape is worth matching properly
 * overrides this with its own file, exactly as the inbox already does — and the
 * inbox's comment is the standard to copy: *"the blocks match the real card
 * sizes, so the page does not jump when it lands."*
 *
 * No text, on purpose. A skeleton that says "Loading…" is a skeleton plus a
 * string to translate, and the `aria-busy` below is what actually reaches a
 * screen reader.
 */
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      {/* The heading block every page opens with. */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      {/* A toolbar: a filter or two on one side, an action on the other. The
          `ms-auto` is logical rather than `ml-`, so it follows the reader. */}
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-28 ms-auto" />
      </div>

      {/* Rows. Six is about a screen at 768px and does not overflow at 375px,
          because each row is a single full-width block rather than columns. */}
      <div className="rounded-lg border">
        <Skeleton className="h-11 w-full rounded-b-none" />
        <div className="flex flex-col gap-px">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-none last:rounded-b-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
