import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `npm run typecheck` must be true of a **clean checkout**, not of a working
 * tree that happens to hold a `.next`.
 *
 * `PageProps<…>` and `LayoutProps<…>` are not imports. They are **globals Next
 * generates into `.next/types` during a build**, so `tsc --noEmit` resolves
 * them on a machine that has built recently and fails on one that has not:
 *
 * ```
 * src/app/(app)/certificates/[id]/page.tsx(26,59): error TS2304: Cannot find name 'PageProps'.
 * src/app/(app)/notices/[id]/page.tsx(35,54):      error TS2304: Cannot find name 'PageProps'.
 * src/app/layout.tsx(44,56):                       error TS2304: Cannot find name 'LayoutProps'.
 * ```
 *
 * Three files used them and nobody noticed for as long as nobody cloned the
 * repository fresh. **Five commits were pushed reporting "typecheck clean",
 * and every one of them was true of a working tree and false of CI** — which
 * is this codebase's own rule about a check that passes for the wrong reason,
 * turned on its own toolchain.
 *
 * The fix is not to run `next build` before `typecheck` in CI. That makes a
 * type check depend on a build, and hides the next instance rather than
 * preventing it. Every other page in `src/app` writes its props out —
 * `{ params: Promise<{ id: string }> }` — and these three now do too.
 *
 * Verified by planting: restoring `PageProps<"/certificates/[id]">` fails this,
 * and it goes green on revert.
 */

const ROOT = process.cwd();

function appFiles(): string[] {
  const root = join(ROOT, "src/app");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => join(root, f));
}

describe("typecheck does not need a build", () => {
  it("never uses a type Next only generates into .next", () => {
    const offenders: string[] = [];
    for (const file of appFiles()) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, ""))
        .join("\n");
      // The angle bracket is what distinguishes the generated global from a
      // locally declared `type PageProps = …`, which would be fine.
      if (/\b(PageProps|LayoutProps|RouteContext)\s*</.test(code)) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(
      offenders,
      "these resolve only when .next/types exists, so a clean checkout cannot typecheck",
    ).toEqual([]);
  });

  /**
   * And the tree really is clean of them, which is worth asserting separately:
   * the scan above is only as good as its file list.
   */
  it("scans the whole of src/app", () => {
    expect(appFiles().length).toBeGreaterThan(80);
  });
});
