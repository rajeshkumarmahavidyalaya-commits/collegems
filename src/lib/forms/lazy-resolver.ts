import type { FieldValues, Resolver } from "react-hook-form";

/**
 * `zodResolver(schema)`, with zod loaded the first time the form validates
 * rather than with the page.
 *
 * Measured on 1 Oct 2026: zod and its resolver were **126 kB** of JavaScript
 * (about 35 kB compressed) on every route with a form, parsed before the page
 * could respond to a tap -- the fee counter was the heaviest route in the
 * product at 225 kB. A form validates on submit, so the schema is not needed
 * to *draw* it, and a page that is only being looked at should not pay for it.
 *
 * Two things keep the first submit from waiting:
 *
 *  - **an idle prefetch.** In the browser, once the page has settled, the
 *    resolver package (and zod with it) is fetched in the background, so by
 *    the time somebody has typed into a field it is almost always there;
 *  - **one load per form.** The promise is kept, so a second validation reuses
 *    the resolver instead of rebuilding it.
 *
 * The server action still validates with the same schema (CLAUDE.md:
 * "the client is a convenience; the server action is the gate"), so nothing
 * about correctness moves -- only when the bytes arrive.
 *
 * `load` must return the schema itself, e.g.
 * `() => import("@/lib/validations/fees").then((m) => m.chargeSchema)`.
 */
export function lazyZodResolver<T extends FieldValues>(load: () => Promise<unknown>): Resolver<T> {
  let ready: Promise<Resolver<T>> | null = null;
  prefetchWhenIdle();
  return (values, context, options) => {
    ready ??= Promise.all([import("@hookform/resolvers/zod"), load()]).then(
      ([{ zodResolver }, schema]) =>
        zodResolver(schema as Parameters<typeof zodResolver>[0]) as unknown as Resolver<T>,
    );
    return ready.then((resolve) => resolve(values, context, options));
  };
}

let prefetched = false;

function prefetchWhenIdle() {
  if (prefetched || typeof window === "undefined") return;
  prefetched = true;
  const start = () => void import("@hookform/resolvers/zod").catch(() => {
    // A failed prefetch is not an error: the first validation loads it again.
    prefetched = false;
  });
  if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 4000 });
  else setTimeout(start, 1500);
}
