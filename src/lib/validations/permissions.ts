import { z } from "zod";

/**
 * The permission screen's shapes, kept out of the `"use server"` module.
 *
 * A `"use server"` file may only export async functions, so a type, a schema or
 * a pure predicate written beside an action is not exportable from it — and a
 * predicate nothing can import is a predicate nothing can test. Same split the
 * arrangements module made for `isCurrentArrangement`.
 */

/** A role's audience. Presentation only — see `roles.tier` and rule 4. */
export const ROLE_TIERS = ["staff", "student", "principal"] as const;
export type RoleTier = (typeof ROLE_TIERS)[number];

export type MatrixRole = { id: string; code: string; name: string; tier: RoleTier };

export type MatrixPermission = { code: string; ability: string; description: string | null };

export type MatrixModule = { module: string; permissions: MatrixPermission[] };

export type PermissionMatrix = {
  roles: MatrixRole[];
  modules: MatrixModule[];
  /** role id -> the codes that role holds. */
  granted: Record<string, string[]>;
  /**
   * The one permission that draws this screen. Named by the server rather than
   * hardcoded here, because the trigger in migration `0211` enforces it and two
   * copies of "which permission is load-bearing" is where they start to differ.
   */
  keystonePermission: string;
};

export const setPermissionSchema = z.object({
  roleId: z.string().uuid(),
  code: z.string().min(1).max(64),
  allowed: z.boolean(),
});

export type SetPermissionInput = z.infer<typeof setPermissionSchema>;

/**
 * Whether clearing this checkbox would shut the door.
 *
 * Purely for the *interface* — a disabled checkbox with a reason beside it,
 * rather than a refusal after the click. The enforcement is the `BEFORE`
 * trigger on `role_permissions`, which is where it has to be: a plain delete
 * through PostgREST routes around anything written in TypeScript.
 *
 * Kept here, importable and testable, for exactly that reason: this is the
 * copy that could silently drift from the trigger, so it is the copy that gets
 * a test.
 */
export function isLastWayBack(
  matrix: Pick<PermissionMatrix, "granted" | "keystonePermission">,
  roleId: string,
  code: string,
): boolean {
  if (code !== matrix.keystonePermission) return false;
  if (!(matrix.granted[roleId] ?? []).includes(code)) return false;

  const others = Object.entries(matrix.granted).filter(
    ([id, codes]) => id !== roleId && codes.includes(code),
  );
  return others.length === 0;
}
