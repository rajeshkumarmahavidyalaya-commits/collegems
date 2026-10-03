import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navForRole } from "@/components/app-shell/nav-config";
import { REFERENCE_EXTRA_HREFS } from "@/components/app-shell/reference-navigation";
import { activeDestination } from "@/components/app-shell/navigation-state";
import { en } from "@/lib/i18n/messages/en";

/**
 * The reference's module menu is presentation only: for every seat it offers
 * exactly the destinations the role filter allowed, plus the two the
 * reference has and this tree does not -- and those only where the screen
 * they belong to is already offered.
 */
const ROLES = ["admin", "teacher", "accountant", "librarian", "parent", "student"];

describe("the reference menu grants nothing", () => {
  for (const role of ROLES) {
    it(`keeps every destination for ${role}, and adds only the two known ones`, () => {
      const original = NAV_GROUPS.flatMap((g) => g.items)
        .filter((item) => !item.roles || item.roles.includes(role))
        .map((item) => item.href);
      const adapted = navForRole(role).flatMap((g) => g.items.map((i) => i.href));
      for (const href of original) expect(adapted, href).toContain(href);
      for (const href of adapted.filter((h) => !original.includes(h))) {
        expect(REFERENCE_EXTRA_HREFS as readonly string[]).toContain(href);
      }
      expect(new Set(adapted).size).toBe(adapted.length);
      if (!original.includes("/academics")) expect(adapted).not.toContain("/academics?tab=subjects");
      if (!original.includes("/academics")) expect(adapted).not.toContain("/academics?tab=holidays");
      // setup_progress() gives every role but the administrator 0 steps on the
      // default matrix, so the wizard follows the sessions screen.
      if (!original.includes("/academics/sessions")) expect(adapted).not.toContain("/setup");
    });
  }

  it("every module heading and renamed entry has an English message", () => {
    for (const group of navForRole("admin")) {
      expect(group.messageKey && en[group.messageKey], group.title).toBeTruthy();
      for (const item of group.items) {
        if (item.messageKey) expect(en[item.messageKey], item.href).toBeTruthy();
      }
    }
  });
});

describe("which entry the address selects", () => {
  it("picks the most specific match, and a tab link only on its tab", () => {
    const links = ["/", "/students", "/students/import", "/academics", "/academics?tab=subjects"];
    expect(activeDestination("/students/import", "", links)).toBe("/students/import");
    expect(activeDestination("/students/123", "", links)).toBe("/students");
    expect(activeDestination("/academics", "tab=subjects", links)).toBe("/academics?tab=subjects");
    expect(activeDestination("/academics", "tab=rooms", links)).toBe("/academics");
    expect(activeDestination("/studentstone", "", links)).toBeNull();
    expect(activeDestination("/", "", links)).toBe("/");
  });

  it("the sidebar selects through it rather than its own prefix test", () => {
    const sidebar = readFileSync(join(process.cwd(), "src/components/app-shell/app-sidebar.tsx"), "utf8");
    expect(sidebar).toMatch(/activeDestination\(/);
    expect(sidebar).not.toMatch(/function isActive/);
  });
});
