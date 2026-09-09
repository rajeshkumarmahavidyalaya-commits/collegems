import { describe, expect, it } from "vitest";
import { NAV_GROUPS } from "@/components/app-shell/nav-config";
import { en } from "@/lib/i18n/messages/en";

/**
 * The menu is not the gate — rule 4 says so twice, and it stays true. What the
 * menu *is* is a claim about who this product is for, and that claim can be
 * wrong in both directions at once.
 *
 * It was. Measured against the live permission matrix, a guardian held ten
 * permissions and the sidebar offered them fourteen entries: three their
 * permissions could not reach (Payroll, Leave, Needs attention) and none of the
 * nine fee screens their `fees.view` could. Every one of the three arrived the
 * same way — an entry written without a `roles` list, under a comment
 * explaining why *staff* all need it.
 *
 * So the guard is on the omission, not on the lists. An entry with no `roles`
 * is offered to all six roles, and that must be a decision somebody made.
 */
const EVERY_ROLE_ON_PURPOSE = new Map<string, string>([
  ["/", "The dashboard gates each block on the matrix and names what it withheld."],
  ["/timetable", "A family reads their child's routine; staff read and edit it."],
  ["/attendance/leave", "The family applies, the school decides — both parties on one screen."],
  ["/homework", "One address, two screens: set it, or do it."],
  ["/study-material", "Published material is for whoever it was published to."],
  ["/report-card", "A family's own cards; staff reach a class's cards through the exam."],
  ["/reports", "report_run gates every report on the matrix; a family runs eight of nineteen."],
  ["/notifications", "Every account has an inbox."],
  ["/notices", "The board is the point; the RLS policy decides the audience."],
  ["/library/books", "The catalogue is a catalogue."],
  ["/settings/language", "Somebody who cannot read the page needs this most."],
]);

const items = NAV_GROUPS.flatMap((group) => group.items);

describe("the navigation's claim about its audience", () => {
  it("offers an entry to every role only where that was decided", () => {
    const universal = items.filter((item) => !item.roles).map((item) => item.href);
    const undeclared = universal.filter((href) => !EVERY_ROLE_ON_PURPOSE.has(href));

    expect(
      undeclared,
      "A nav entry with no `roles` list is shown to a parent and a student too. " +
        "If that is right, add it to EVERY_ROLE_ON_PURPOSE with the reason; if it is " +
        "not, give it a roles list. Payroll and Leave were both this mistake.",
    ).toEqual([]);
  });

  it("keeps the staff-only modules away from a family", () => {
    // The three that were wrong, pinned by name so a later edit that drops a
    // roles list fails here rather than on a parent's screen.
    for (const href of ["/payroll", "/hr/leave", "/checks", "/staff", "/fees/counter"]) {
      const item = items.find((i) => i.href === href);
      expect(item, `${href} is missing from the menu`).toBeDefined();
      expect(item!.roles, `${href} must name its roles`).toBeDefined();
      expect(item!.roles).not.toContain("parent");
      expect(item!.roles).not.toContain("student");
    }
  });

  it("gives a family a door into the fee module", () => {
    const familyFees = items.find((i) => i.href === "/fees/family");
    expect(familyFees, "a family had no way to reach their own fee account").toBeDefined();
    expect(familyFees!.roles).toContain("parent");
    expect(familyFees!.roles).toContain("student");
  });

  it("has a translated label for every entry and group", () => {
    // The mirror of rule 15's "a string in the catalogue is not a control on
    // the page": a control on the page with no string renders English to a
    // reader who chose otherwise, silently.
    const keys = [
      ...NAV_GROUPS.map((g) => g.messageKey),
      ...items.map((i) => i.messageKey),
    ];
    const missing = keys.filter((key) => !key || !(key in en));
    expect(missing, "nav entries with no message key, or a key English does not have").toEqual([]);
  });
});
