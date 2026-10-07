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
    // 42, not 40: the school calendar (0297) and class tests (0304) are
    // everyday screens a family reaches too, so neither can fold into Setup
    // (the next test forbids it), and hiding a daily screen there to meet a
    // count would make the menu worse, not shorter. Raise this only for a
    // screen that is genuinely used every day, and say which.
    // 45 (0321): Expenses and Donation are written as the money moves, the
    // way the voucher book is, and Student Birthdays is read each morning --
    // three of the reference's everyday screens, none of them set-up.
    // 46 (0323): School Management, the card per school, is the reference's
    // first page and where an administrator starts every day. The Schools
    // table beside it is Setup.
    // 47 (0329): Subject Attendance, where the teacher of a subject takes its
    // register every day it is taught -- an everyday screen beside the daily
    // register, not a set-up one.
    // 48 (0342): Gate Passes, written at the gate every time somebody comes
    // for a child -- the visitor log's everyday half, not a set-up screen.
    // 49 (0343): Events, which a family opens to put its child on one, so it
    // cannot fold into Setup (the next test forbids it).
    // 50 (0344): Staff Rating, where a student rates their teachers -- a
    // family-side screen, so it cannot fold into Setup either.
    // 51 (0347): Lessons, which a student opens to study and a teacher adds to
    // as the chapter is taught -- a family-side screen, like Events.
    // 53 (0348): Tickets, which a family raises and staff work every day, and
    // Activities, where a club's students are added and taken off as they
    // join -- the reference's SM Tickets and SM Activities, neither set-up.
    // 54 (0350): Chat, where a teacher and a family write to each other --
    // the reference's SM Chat, read and answered daily.
    expect(everyday).toBeLessThanOrEqual(54);
  });

  it("never marks a screen a family uses as setup", () => {
    // A family's menu is short already; hiding part of it behind "Setup"
    // would only hide it.
    for (const role of ["parent", "student"]) {
      expect(splitSetup(navForRole(role)).setup.map((i) => i.href), role).toEqual([]);
    }
  });

  // The reference layout replaced the fold: every screen sits in its module
  // (School Management, SM School, ...), so the sidebar draws the module tree
  // and no longer splits it. The split stays the definition of set-up order.
  it("draws the sidebar from the module tree, and the palette from the whole tree", () => {
    const sidebar = readFileSync(join(process.cwd(), "src/components/app-shell/app-sidebar.tsx"), "utf8");
    expect(sidebar).not.toMatch(/splitSetup/);
    expect(sidebar).toMatch(/navGroups\.map\(section\)/);
    const palette = readFileSync(join(process.cwd(), "src/components/app-shell/command-palette.tsx"), "utf8");
    expect(palette).not.toMatch(/splitSetup/);
    expect(NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.setup).length).toBeGreaterThan(0);
  });
});
