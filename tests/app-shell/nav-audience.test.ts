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
 *
 * ## …and a reason written down is not a reason that was checked
 *
 * Two of the entries below said *"every role has business here"* and were
 * true of four roles. Measured as an accountant and as a librarian on the live
 * college — the two seats nobody signs into — `/homework` and
 * `/attendance/leave` returned **0 rows each**, because neither role has a
 * SELECT policy on `homework` or on `student_leave_requests` at all. Both now
 * carry a `roles` list and are gone from this map.
 *
 * So each reason here names the **mechanism** that makes it true, and the ones
 * that survived were re-measured rather than re-read. A count is deliberately
 * not quoted: `/reports` used to claim *"a family runs eight of nineteen"* and
 * a family runs **two** since migration `0200` moved five gates. A number in a
 * comment is a number that goes stale silently; the mechanism does not.
 */
const EVERY_ROLE_ON_PURPOSE = new Map<string, string>([
  ["/", "dashboard_summary() gates each block on the matrix and names what it withheld."],
  ["/timetable", "A family reads their child's routine; staff read and edit it."],
  ["/study-material", "Published material is for whoever it was published to."],
  ["/reports", "report_list() narrows the catalogue to what the caller's matrix allows."],
  ["/notifications", "Every account has an inbox."],
  ["/notices", "The board is the point; notice_matches_me(audience) decides who sees what."],
  ["/library/books", "The catalogue is a catalogue."],
  ["/settings/language", "Somebody who cannot read the page needs this most."],
  ["/assistant", "It reads with the asker's own token, so RLS and the matrix scope each seat's answers."],
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

  it("has no declaration left over for an entry that now names its roles", () => {
    // The other direction, which nothing checked. `/report-card` sat in this
    // map for months after it was given `roles: ["parent", "student"]`, so the
    // map had a line explaining a decision that was no longer being made.
    // An allowlist read in one direction rots; this is the second reading.
    const universal = new Set(items.filter((item) => !item.roles).map((item) => item.href));
    const stale = [...EVERY_ROLE_ON_PURPOSE.keys()].filter((href) => !universal.has(href));

    expect(
      stale,
      "these are declared as shown to every role, and they name their roles. " +
        "Delete the declaration — a reason nobody is relying on is a reason nobody checks.",
    ).toEqual([]);
  });

  it("keeps a screen built for two audiences away from the other two", () => {
    // Both were role-less under a comment about "two screens" or "both
    // parties" — phrases that name two of the six roles. An accountant and a
    // librarian read zero rows from either module's tables.
    for (const href of ["/homework", "/attendance/leave"]) {
      const item = items.find((i) => i.href === href);
      expect(item, `${href} is missing from the menu`).toBeDefined();
      expect(item!.roles, `${href} must name its roles`).toBeDefined();
      expect(item!.roles).toContain("parent");
      expect(item!.roles).toContain("student");
      expect(item!.roles, "no SELECT policy reaches this module").not.toContain("accountant");
      expect(item!.roles, "no SELECT policy reaches this module").not.toContain("librarian");
    }
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
