import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navForRole, splitSetup } from "@/components/app-shell/nav-config";

/**
 * The sidebar folds once-a-year screens into one collapsed "Setup" section.
 * That is presentation only: the split must lose nothing, move nothing between
 * roles, and leave the command palette able to find every entry.
 */
const ROLES = ["admin", "teacher", "accountant", "librarian", "parent", "student"];

describe("the daily menu and the setup menu", () => {
  it("loses and duplicates nothing for any role", () => {
    for (const role of ROLES) {
      const tree = navForRole(role);
      const { daily, setup } = splitSetup(tree);
      const before = tree.flatMap((g) => g.items.map((i) => i.href)).sort();
      const after = [...daily.flatMap((g) => g.items.map((i) => i.href)), ...setup.map((i) => i.href)].sort();
      expect(after, role).toEqual(before);
    }
  });

  it("keeps the super admin's everyday menu short", () => {
    const { daily, setup } = splitSetup(navForRole("admin"));
    const everyday = daily.reduce((n, g) => n + g.items.length, 0);
    expect(setup.length).toBeGreaterThanOrEqual(15);
    expect(everyday).toBeLessThanOrEqual(40);
  });

  it("never marks a screen a family uses as setup", () => {
    // A family's menu is short already; hiding part of it behind "Setup"
    // would only hide it.
    for (const role of ["parent", "student"]) {
      expect(splitSetup(navForRole(role)).setup.map((i) => i.href), role).toEqual([]);
    }
  });

  it("draws the sidebar from the split, and the palette from the whole tree", () => {
    const sidebar = readFileSync(join(process.cwd(), "src/components/app-shell/app-sidebar.tsx"), "utf8");
    expect(sidebar).toMatch(/splitSetup\(navGroups\)/);
    const palette = readFileSync(join(process.cwd(), "src/components/app-shell/command-palette.tsx"), "utf8");
    expect(palette).not.toMatch(/splitSetup/);
    expect(NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.setup).length).toBeGreaterThan(0);
  });
});
