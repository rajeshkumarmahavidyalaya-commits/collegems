import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import {
  categoryLabel,
  categoryTone,
  noticeSchema,
  parseReadSummary,
  publishSentence,
  readRate,
  statusTone,
  withdrawSchema,
} from "@/lib/validations/notices";

/**
 * The notice board's client half, without a database.
 *
 * The one that matters here is `publishSentence`. Publishing has three
 * outcomes, and conflating any two of them is how a school comes to believe
 * four hundred parents were told about something.
 */

describe("what publishing did", () => {
  it("says so when everybody was told", () => {
    expect(publishSentence({ notice_id: "n", status: "published", announced: true })).toBe(
      "Published, and everybody it is for has been told.",
    );
  });

  it("does not report a failed announcement as a failed publish", () => {
    // The board is the point and the announcement is a courtesy. A Grade 1
    // circular whose parents have no logins yet must still go up, and the
    // sentence has to make both halves true at once.
    const sentence = publishSentence({
      notice_id: "n",
      status: "published",
      announced: false,
      error: "That audience matched nobody with a login, so nothing was sent",
    });
    expect(sentence).toMatch(/^Published\./);
    expect(sentence).toContain("matched nobody");
    expect(sentence).toContain("on the board either way");
  });

  it("explains a re-publish that deliberately did not re-announce", () => {
    const sentence = publishSentence({
      notice_id: "n",
      status: "published",
      announced: false,
      note: "Already announced 1 time(s). Publishing again does not re-announce -- use \"announce again\" if that is what you want.",
    });
    expect(sentence).toContain("does not re-announce");
  });
});

describe("read rate", () => {
  it("has no rate at all when the notice was for nobody", () => {
    // Not 0%. A notice addressed to a role nobody holds has not been ignored.
    expect(readRate({ audience: 0, read: 0 })).toBeNull();
  });

  it("rounds to a whole percent", () => {
    expect(readRate({ audience: 3, read: 1 })).toBe(33);
    expect(readRate({ audience: 4, read: 4 })).toBe(100);
  });
});

describe("parsing the summary", () => {
  it("reads what the database sends", () => {
    const parsed = parseReadSummary({ audience: 40, read: 12, announced: 1, last_announce_error: null });
    expect(parsed).toEqual({ audience: 40, read: 12, announced: 1, last_announce_error: null });
  });

  it("returns null rather than throwing on a shape it does not know", () => {
    expect(parseReadSummary("nope")).toBeNull();
    expect(parseReadSummary(null)).toBeNull();
  });
});

describe("writing one", () => {
  const base = {
    title: "Sports day",
    body: "Sports day will be held on the first Saturday of next month.",
    category: "event" as const,
    audience: { kind: "all" as const },
    isPinned: false,
  };

  it("accepts a well-formed notice", () => {
    expect(noticeSchema.safeParse(base).success).toBe(true);
  });

  it("refuses an empty one", () => {
    expect(noticeSchema.safeParse({ ...base, body: "short" }).success).toBe(false);
    expect(noticeSchema.safeParse({ ...base, title: "x" }).success).toBe(false);
  });

  it("refuses a window that closes before it opens", () => {
    const result = noticeSchema.safeParse({
      ...base,
      startsOn: "2026-10-01",
      expiresOn: "2026-09-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/before it goes up/);
    }
  });

  it("allows an open-ended window", () => {
    expect(noticeSchema.safeParse({ ...base, startsOn: "2026-10-01" }).success).toBe(true);
    expect(noticeSchema.safeParse({ ...base, expiresOn: "2026-10-01" }).success).toBe(true);
  });

  it("will not withdraw without a reason", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(withdrawSchema.safeParse({ noticeId: id, reason: "" }).success).toBe(false);
    expect(withdrawSchema.safeParse({ noticeId: id, reason: "Wrong date" }).success).toBe(true);
  });
});

describe("how a notice is shown", () => {
  it("tints only the urgent one, and never carries the meaning in the tint", () => {
    // CLAUDE.md: amber is for sparing emphasis. A board where every category
    // has its own colour is a board where none of them means anything -- and
    // the label is always present regardless.
    expect(categoryTone("urgent")).toBe("warning");
    expect(categoryTone("circular")).toBe("outline");
    expect(categoryTone("general")).toBe("outline");
    // The label is looked up in the reader's catalogue now, so the test
    // supplies one. English is asserted here; the three-locale coverage is
    // `tests/i18n/i18n.test.ts`'s floor.
    const t = createTranslator("en");
    expect(categoryLabel("examination", t)).toBe("Examination");

    // A value the catalogue has no key for falls back to the value itself,
    // never to the key -- `notices.category.something_else` on a badge is
    // worse than the word the database actually stored.
    expect(categoryLabel("something_else", t)).toBe("something_else");
  });

  it("distinguishes the three statuses", () => {
    expect(statusTone("published")).toBe("success");
    expect(statusTone("withdrawn")).toBe("destructive");
    expect(statusTone("draft")).toBe("secondary");
  });
});
