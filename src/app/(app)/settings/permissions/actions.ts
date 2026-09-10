"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  setPermissionSchema,
  type PermissionMatrix,
  type MatrixModule,
  type MatrixRole,
} from "@/lib/validations/permissions";
import type { ActionResult } from "../../library/actions";

/**
 * The permission matrix, read and written.
 *
 * Rule 4 has always said a college can grant a teacher `students.manage` any
 * Tuesday. Until this file, nothing in the product could: `role_permissions`
 * was read by `hasPermission()` on every page and written by migrations alone.
 *
 * **Nothing here is the gate.** `admins manage role_permissions` (migration
 * `0005`) is, and it is a policy rather than a check in this file — so a
 * teacher calling `setPermission` directly writes 0 rows. Probed live as a
 * teacher: `0 rows touched`, no error raised, which is what RLS does and what
 * rule 6 says to assert.
 */

/** One round trip for the whole grid — see migration `0212`. */
export async function getMatrix(): Promise<PermissionMatrix | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("permission_matrix");
  if (error || !data) return null;

  const doc = data as {
    roles?: MatrixRole[];
    modules?: MatrixModule[];
    granted?: Record<string, string[]>;
    keystone_permission?: string;
  };

  return {
    roles: doc.roles ?? [],
    modules: doc.modules ?? [],
    granted: doc.granted ?? {},
    keystonePermission: doc.keystone_permission ?? "users.manage",
  };
}

/**
 * Grant or revoke one permission for one role.
 *
 * A grant is a row; a revocation is its absence. `role_has_permission()` asks
 * for a row with `allowed`, so deleting and inserting are the whole vocabulary
 * — and both are audited, because `role_permissions` carries the rule 9
 * trigger like every other table.
 *
 * The one refusal it can meet comes from Postgres, not from here: taking
 * `users.manage` off the last role that holds it leaves nobody able to open
 * this screen and give it back. The message is the trigger's, passed through
 * unedited, because it is written for the person who just clicked.
 */
export async function setPermission(
  roleId: string,
  code: string,
  allowed: boolean,
): Promise<ActionResult<{ roleId: string; code: string; allowed: boolean }>> {
  const parsed = setPermissionSchema.safeParse({ roleId, code, allowed });
  if (!parsed.success) {
    return { ok: false, error: "That is not a permission this product has." };
  }

  const supabase = await createClient();

  if (parsed.data.allowed) {
    // The tenant comes from the role's own row rather than from the caller:
    // RLS refuses a role in another college, so there is nothing to check here
    // that Postgres is not already checking.
    const { data: role, error: roleError } = await supabase
      .from("roles")
      .select("tenant_id")
      .eq("id", parsed.data.roleId)
      .maybeSingle();

    if (roleError || !role) return { ok: false, error: "That role is not in this college." };

    const { error } = await supabase
      .from("role_permissions")
      .upsert(
        {
          tenant_id: role.tenant_id,
          role_id: parsed.data.roleId,
          permission_code: parsed.data.code,
          allowed: true,
        },
        { onConflict: "tenant_id,role_id,permission_code" },
      );

    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", parsed.data.roleId)
      .eq("permission_code", parsed.data.code);

    if (error) return { ok: false, error: error.message };
  }

  // Every gated menu entry and button on every screen reads this, so the whole
  // shell is stale after one checkbox.
  revalidatePath("/", "layout");
  return { ok: true, data: parsed.data };
}
