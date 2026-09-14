import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import {
  CARDS_PER_SHEET,
  CARD_ASPECT,
  MAX_CARDS_PER_RUN,
  cardGaps,
  setSummary,
  type IdCard,
} from "@/lib/validations/id-card";

/**
 * An identity card is a statement about **now**, and nothing here freezes it.
 *
 * Rule 12 says *"anything printed on a document a person keeps is frozen when
 * the document is made"*, and this module deliberately does not — which is the
 * single decision most likely to be "corrected" by somebody who has read that
 * rule and not the reason it stops here:
 *
 * > A report card is a statement about a term that has ended. A certificate is a
 * > statement about a day. **An identity card is a statement about now**, so
 * > freezing it would print last year's class on the card a child is carrying
 * > this year.
 *
 * That is rule 4's second boundary asked of a document rather than a foreign
 * key. `substitutions` freezes because it records a morning; this recomputes
 * because it records a fact that is still true.
 *
 * Runs without a database.
 */

const ROOT = process.cwd();

function read(p: string) {
  return readFileSync(join(ROOT, p), "utf8");
}

/**
 * Comments out before anything matches on source.
 *
 * Third instance in this codebase, and by now it is a habit rather than a
 * discovery: the `operator-boundary` guard passed on a commented-out revoke;
 * the `route-boundaries` guard failed on a comment that *explained* the rule it
 * was checking; and the page-break assertion below failed because
 * `IdCardSheet`'s doc comment — which sits inside the slice of source belonging
 * to `IdCardFace` — mentions the attribute it is asserting is absent.
 *
 * **A guard that reads prose reports on the prose**, in both directions: a
 * comment can hide a violation and it can fake one.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CARD: IdCard = {
  studentId: "s1",
  fullName: "Aditi Sharma",
  admissionNumber: "ADM-0001",
  className: "Grade 6 · A",
  rollNumber: "12",
  dateOfBirth: "2013-04-02",
  bloodGroup: "O+",
  guardianName: "Ravi Sharma",
  guardianPhone: "+91 98765 43210",
  address: "12 Nehru Road, Pune",
  photoUrl: "https://example.test/signed",
};

describe("a card is not a certificate", () => {
  it("stores nothing and numbers nothing", () => {
    // A serial would make losing a card a paperwork problem. `document_sequences`
    // exists for a *gapless* record — a certificate with a hole in its numbering
    // is one nobody can audit — and a reprinted ID card is not that.
    const migrations = readdirSync(join(ROOT, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8"))
      .join("\n");

    expect(
      /create table [^;]*\bid_cards?\b/i.test(migrations),
      "There is no id_cards table, on purpose: the card is recomputed from the " +
        "child's current record every time it is printed.",
    ).toBe(false);
    expect(
      /'id_card'|"id_card"/.test(migrations),
      "No document_sequences kind for a card. Numbering it would make reprinting " +
        "a lost card an auditable event, which it is not.",
    ).toBe(false);

    // And the module itself writes nothing.
    const actions = read("src/app/(app)/students/id-cards/actions.ts");
    expect(/\.insert\(|\.upsert\(/.test(actions), "the card reader must not write").toBe(false);
  });

  it("carries the year it is valid for", () => {
    // A document about *now* must say which now, or it is a card with no expiry
    // that a fifteen-year-old is still holding at twenty. Resolved server-side
    // from the context, never taken from the caller (rule 2).
    const actions = read("src/app/(app)/students/id-cards/actions.ts");
    expect(actions).toMatch(/currentSessionName/);
    expect(read("src/lib/i18n/messages/en.ts")).toMatch(/"idCard\.validFor"/);
  });

  it("scopes the class to this year's enrolment", () => {
    // The reason this cannot be a plain read of `students`: a child has one
    // enrolment per year, and an unscoped join prints the class they were in
    // two years ago. Rule 2's read-side lesson, which only became visible on
    // the one college that has rolled a year forward.
    const actions = read("src/app/(app)/students/id-cards/actions.ts");
    expect(actions).toMatch(/session_id/);
    expect(actions).toMatch(/currentSessionId/);
  });
});

describe("what is missing is said, not refused", () => {
  it("treats a missing photograph as blocking and the rest as not", () => {
    const t = createTranslator("en");

    expect(cardGaps(CARD, t)).toEqual([]);

    const noPhoto = cardGaps({ ...CARD, photoUrl: null }, t);
    expect(noPhoto).toHaveLength(1);
    expect(noPhoto[0].blocking, "a card with no face is not an identity card").toBe(true);

    const noBlood = cardGaps({ ...CARD, bloodGroup: null }, t);
    expect(noBlood).toHaveLength(1);
    expect(
      noBlood[0].blocking,
      "a card with no blood group is still a usable card — this is the " +
        "grading_scheme_problems() shape, not the certificate refusal",
    ).toBe(false);
  });

  it("puts the blocking gap first", () => {
    // Somebody scanning a class of forty reads the top of the list.
    const t = createTranslator("en");
    const gaps = cardGaps({ ...CARD, photoUrl: null, bloodGroup: null }, t);
    expect(gaps[0].field).toBe("photoUrl");
  });

  it("summarises a set with a plural rather than a stem and a rule", () => {
    const t = createTranslator("en");
    expect(setSummary([CARD], t)).toBeNull();
    expect(setSummary([{ ...CARD, photoUrl: null }], t)).toBe("1 card has no photograph.");
    expect(setSummary([{ ...CARD, photoUrl: null }, { ...CARD, photoUrl: null }], t)).toBe(
      "2 cards have no photograph.",
    );
    // Both forms exist in every locale, because English plurals are not
    // derivable and neither are anybody else's.
    for (const locale of ["hi", "ur"] as const) {
      const tt = createTranslator(locale);
      expect(tt.plural("idCard.missingPhotos", 1, { count: 1 })).not.toMatch(/^idCard\./);
      expect(tt.plural("idCard.missingPhotos", 5, { count: 5 })).not.toMatch(/^idCard\./);
    }
  });
});

describe("the photograph is a signed URL and stays one", () => {
  it("does not hand a child's photograph to next/image", () => {
    // **The one that matters.** The optimiser fetches the signed URL
    // server-side and caches the result behind a stable, unsigned
    // `/_next/image?url=…` address — which converts a ten-minute bearer token
    // into a permanent public one. Rule 8 says the signature *is* the
    // authorization; an optimiser that strips it removes the authorization.
    for (const file of [
      "src/components/id-card/id-card-sheet.tsx",
      "src/app/(app)/students/[id]/photo-control.tsx",
    ]) {
      const src = read(file);
      expect(
        /from "next\/image"/.test(src),
        `${file} must not use next/image: it would give a child's photograph a ` +
          `stable public URL that outlives the signature.`,
      ).toBe(false);
    }
  });

  it("never stores a URL, only a path", () => {
    // Rule 8: the object *path* in the database, never a public URL.
    const actions = read("src/app/(app)/students/photo-actions.ts");
    expect(actions).toMatch(/photo_path: uploaded\.path/);
    expect(/photo_path:\s*(signed|url|http)/i.test(actions)).toBe(false);
  });

  it("keeps the dictionary out of a route that had none", () => {
    // Measured three ways rather than argued. `PhotoControl` first called
    // `useI18n()`, which is the ordinary shape for a client component and the
    // wrong one here:
    //
    //   /students/[id]   165 kB  before
    //                    187 kB  with useI18n()      (+22)
    //                    166 kB  with labels as props (+1)
    //
    // `sonner` was already on the route through `ExitControl`, so every byte of
    // that 22 kB was the message catalogue arriving for the *first* time on a
    // route that had never had a client-side i18n consumer.
    // `docs/ui-review.md` already named 16 kB as the point where that is worth
    // avoiding, and this was past it.
    //
    // **A component that needs a handful of words does not need the
    // dictionary.** The parent is a Server Component holding `t` from
    // `getT()`; it resolves eight strings and passes them down.
    const src = withoutComments(read("src/app/(app)/students/[id]/photo-control.tsx"));
    expect(
      /useI18n/.test(src),
      "PhotoControl must take its labels as props: calling useI18n() here pulls " +
        "the whole catalogue onto a route that has no other client-side consumer, " +
        "measured at +22 kB against +1 kB for props.",
    ).toBe(false);
    expect(src).toMatch(/labels: PhotoLabels/);
  });

  it("keeps the card face a Server Component", () => {
    // It takes `t` and `locale` as props rather than calling a hook — rule 15's
    // fourth shape, and the one that shipped a blank screen for every teacher
    // opening their own week when a Server Component reached for `useI18n`.
    const src = read("src/components/id-card/id-card-sheet.tsx");
    expect(src.includes('"use client"'), "the card face ships no JavaScript").toBe(false);
    expect(src).toMatch(/t: Translator/);
    expect(src).toMatch(/locale: Locale/);
  });
});

describe("bounded, and the bound is said out loud", () => {
  it("refuses a class larger than it prints rather than truncating", () => {
    // Rule 13: a sheet holding the first 120 of 300 children looks complete.
    const actions = read("src/app/(app)/students/id-cards/actions.ts");
    expect(actions).toMatch(/MAX_CARDS_PER_RUN/);
    expect(actions).toMatch(/reason: "too-many"/);
    expect(read("src/lib/i18n/messages/en.ts")).toMatch(/"idCard\.tooMany"/);
    expect(MAX_CARDS_PER_RUN).toBeGreaterThan(0);
  });

  it("keeps the card the shape a laminating pouch is cut for", () => {
    // CR80, the bank-card rectangle. Any other ratio produces cards that do not
    // fit the holders a school already owns — which nobody discovers until four
    // hundred have been cut.
    expect(CARD_ASPECT).toBe("85.6 / 54");
    expect(CARDS_PER_SHEET).toBe(8);
  });

  it("puts the page break on the sheet, not on the card", () => {
    // The report-card module puts `data-print="page"` on every card, correctly:
    // a report card *is* a page. Copying that here would waste seven sheets in
    // every eight.
    const src = withoutComments(read("src/components/id-card/id-card-sheet.tsx"));
    const sheetSection = src.slice(src.indexOf("export function IdCardSheet"));
    expect(sheetSection).toMatch(/data-print="page"/);
    const faceSection = src.slice(
      src.indexOf("export function IdCardFace"),
      src.indexOf("export function IdCardSheet"),
    );
    expect(
      /data-print="page"/.test(faceSection),
      "a card is not a page — eight of them share one",
    ).toBe(false);
    expect(faceSection).toMatch(/data-print="keep"/);
  });
});
