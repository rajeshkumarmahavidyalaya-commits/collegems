import { describe, expect, it } from "vitest";
import { MODULE_PREFIXES, navForRole } from "@/components/app-shell/nav-config";

/**
 * A school's own menu switches (`modules.menu`, 0326) leave whole modules out
 * of its menu. Presentation only, so the one property that matters is that a
 * switch can take an entry away and never add one, for any seat.
 */
const ROLES = ["admin", "teacher", "accountant", "librarian", "parent", "student"];
const hrefs = (role: string, hidden: string[] = []) => navForRole(role, hidden).flatMap((g) => g.items.map((i) => i.href));

describe("a school's menu switches", () => {
  it("only ever take entries away", () => {
    const all = Object.keys(MODULE_PREFIXES);
    for (const role of ROLES) {
      const full = new Set(hrefs(role));
      for (const href of hrefs(role, all)) expect(full.has(href), `${role} ${href}`).toBe(true);
    }
  });

  it("a switched-off module leaves none of its addresses in the menu", () => {
    for (const [module, prefixes] of Object.entries(MODULE_PREFIXES)) {
      const left = hrefs("admin", [module]).map((h) => h.split("?")[0]);
      for (const p of prefixes) {
        expect(left.filter((h) => h === p || h.startsWith(`${p}/`)), module).toEqual([]);
      }
    }
  });

  it("everything else stays: switching Library off keeps Students and Fees", () => {
    const left = hrefs("admin", ["library"]);
    expect(left).toContain("/students");
    expect(left.some((h) => h.startsWith("/fees"))).toBe(true);
    expect(left.some((h) => h.startsWith("/library"))).toBe(false);
  });

  it("every module the setting can switch has a prefix, and no more", () => {
    // The keys of the modules.menu catalogue row (0326).
    expect(Object.keys(MODULE_PREFIXES).sort()).toEqual(
      ["accounts", "certificates", "exams", "homework", "hostel", "inventory", "library", "live_classes", "payroll", "transport"],
    );
  });
});
