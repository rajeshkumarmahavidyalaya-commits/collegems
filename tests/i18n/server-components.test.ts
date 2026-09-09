import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A hook in a Server Component compiles, builds, and throws on the first render.
 *
 * `week-view.tsx` has no `"use client"` and a comment that says so — *"a
 * read-only view, so it is a Server Component with no state at all"* — and the
 * weekday batch put `useI18n()` in it anyway. `tsc` was happy, `next build` was
 * happy, and `/timetable/me` would have thrown for every teacher and every
 * student who opened their own week. It shipped in one commit and was found by
 * the next one's typecheck for an unrelated reason.
 *
 * Nothing in this repo was watching for it, so:
 *
 * > **A file with no `"use client"` may not call a hook.** That is not a style
 * > rule — it is the only place the compiler cannot tell you, and the failure
 * > is a blank screen rather than a red squiggle.
 *
 * eslint's `react-hooks/rules-of-hooks` catches a hook in the wrong *function*;
 * it does not know which *file* runs on the server. This does.
 */
const HOOKS = [
  "useI18n",
  "useT",
  "useState",
  "useEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useReducer",
  "useContext",
  "useTransition",
  "useRouter",
  "useSearchParams",
  "usePathname",
  "useForm",
  "useQuery",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("a Server Component does not call a hook", () => {
  it("holds for every .tsx under src", () => {
    const offenders: string[] = [];

    for (const path of [...walk("src/app"), ...walk("src/components")]) {
      const src = readFileSync(path, "utf8");
      if (/^\s*["']use client["']/.test(src)) continue;

      // Strip comments so prose about a hook is not mistaken for a call.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      for (const hook of HOOKS) {
        if (new RegExp(`\\b${hook}\\s*\\(`).test(code)) {
          offenders.push(`${path.replace(/\\/g, "/")} calls ${hook}()`);
        }
      }
    }

    expect(
      offenders,
      "These files have no \"use client\" and call a React hook, which throws at " +
        "render. Either add the directive, or use the server equivalent — " +
        "`await getT()` and `await getLocale()` for i18n.",
    ).toEqual([]);
  });
});
