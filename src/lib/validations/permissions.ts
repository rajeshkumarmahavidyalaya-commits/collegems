import { z } from "zod";

/**
 * The permission screen's shapes, kept out of the `"use server"` module.
 *
 * A `"use server"` file may only export async functions, so a type, a schema or
 * a pure predicate written beside an action is not exportable from it — and a
 * predicate nothing can import is a predicate nothing can test. Same split the
 * arrangements module made for `isCurrentArrangement`.
 */
export { ROLE_TIERS, isLastWayBack } from "./permissions-display";
export type { RoleTier, MatrixRole, MatrixPermission, MatrixModule, PermissionMatrix } from "./permissions-display";

export const setPermissionSchema = z.object({
  roleId: z.string().uuid(),
  code: z.string().min(1).max(64),
  allowed: z.boolean(),
});

export type SetPermissionInput = z.infer<typeof setPermissionSchema>;
