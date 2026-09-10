import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLastWayBack } from "@/lib/validations/permissions";

/**
 * The one checkbox on the permission screen that cannot be cleared.
 *
 * `users.manage` draws `/settings/permissions`, and in a new college exactly
 * one role holds it. Clearing that box would leave the matrix editable only
 * from a database console, which a college does not have — so the edit is
 * refused.
 *
 * It is refused in **two** places, and that is the thing worth guarding:
 *
 * - a `BEFORE DELETE OR UPDATE` trigger on `role_permissions` (migration
 *   `0211`), which is the enforcement, because a plain delete through
 *   PostgREST routes around anything written in TypeScript;
 * - `isLastWayBack()`, which only draws the checkbox as locked, so somebody
 *   meets the rule before the click rather than after it.
 *
 * The second is a copy of the first, which is exactly the drift this codebase
 * keeps paying for (`library.fine_per_day` in five places, `formatMoney` under
 * four names). So the predicate gets pinned to numbers, and the trigger's
 * existence is asserted against the migrations.
 */

const KEYSTONE = "users.manage";

const ADMIN = "11111111-1111-1111-1111-111111111111";
const ACCOUNTANT = "22222222-2222-2222-2222-222222222222";
const TEACHER = "33333333-3333-3333-3333-333333333333";

/** A new college, exactly as `platform_start_school` leaves it. */
const FRESH = {
  keystonePermission: KEYSTONE,
  granted: {
    [ADMIN]: [KEYSTONE, "students.manage", "fees.collect"],
    [ACCOUNTANT]: ["fees.collect", "reports.view"],
    [TEACHER]: ["students.view", "attendance.mark"],
  },
};

describe("the last way back into the matrix", () => {
  it("locks the keystone on the only role holding it", () => {
    expect(isLastWayBack(FRESH, ADMIN, KEYSTONE)).toBe(true);
  });

  it("unlocks it once a second role holds it", () => {
    const shared = {
      ...FRESH,
      granted: { ...FRESH.granted, [ACCOUNTANT]: [...FRESH.granted[ACCOUNTANT], KEYSTONE] },
    };
    // Both are now removable — which is right, and is why the rule counts
    // *other* rows rather than marking one role as the special one.
    expect(isLastWayBack(shared, ADMIN, KEYSTONE)).toBe(false);
    expect(isLastWayBack(shared, ACCOUNTANT, KEYSTONE)).toBe(false);
  });

  it("never locks an ordinary permission, however alone it is", () => {
    // `students.manage` is held by one role here and is freely removable: the
    // rule is about the way back to *this screen*, not about being the last
    // holder of anything.
    expect(isLastWayBack(FRESH, ADMIN, "students.manage")).toBe(false);
    expect(isLastWayBack(FRESH, TEACHER, "attendance.mark")).toBe(false);
  });

  it("does not lock a box that is not ticked", () => {
    // Granting the keystone to a second role must never be refused — that is
    // the way *out* of the locked state.
    expect(isLastWayBack(FRESH, ACCOUNTANT, KEYSTONE)).toBe(false);
    expect(isLastWayBack(FRESH, TEACHER, KEYSTONE)).toBe(false);
  });

  it("survives a role with no permissions at all", () => {
    const withEmpty = { ...FRESH, granted: { ...FRESH.granted, unknown: [] } };
    expect(isLastWayBack(withEmpty, "unknown", KEYSTONE)).toBe(false);
    expect(isLastWayBack(withEmpty, ADMIN, KEYSTONE)).toBe(true);
  });

  it("is backed by a trigger, not only by this predicate", () => {
    // The UI copy is a convenience. If the trigger ever goes, a delete through
    // PostgREST empties the matrix's own door and this file's other five tests
    // would still pass — so the enforcement is asserted separately.
    const migrations = join(process.cwd(), "supabase/migrations");
    const all = readdirSync(migrations)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(migrations, f), "utf8"))
      .join("\n");

    expect(
      /create\s+trigger\s+keep_a_way_back[\s\S]{0,200}?before\s+delete\s+or\s+update\s+on\s+public\.role_permissions/i.test(
        all,
      ),
      "role_permissions must keep a BEFORE DELETE OR UPDATE trigger guarding the keystone permission.",
    ).toBe(true);

    // …and the trigger and the predicate must be arguing about the same code.
    expect(all).toContain("'users.manage'");
  });
});
