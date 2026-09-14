import { readFileSync, readdirSync, statSync } from "node:fs";
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

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) tsFiles(p, acc);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) acc.push(p);
  }
  return acc;
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
    // from the context, never taken from the caller (rule 2) — and read in one
    // place, which is where this assertion now points after `schoolIdentity`
    // moved out of the card module.
    const identity = read("src/lib/school/identity.ts");
    expect(identity).toMatch(/currentSessionName/);
    expect(
      /sessionName[^\n]*(searchParams|params\.|input|p_session)/i.test(identity),
      "the session on a card is resolved server-side, never taken from the caller",
    ).toBe(false);
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
      "src/components/people/photo-control.tsx",
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
    for (const file of [
      "src/app/(app)/students/photo-actions.ts",
      "src/app/(app)/staff/photo-actions.ts",
    ]) {
      const actions = read(file);
      expect(actions, file).toMatch(/photo_path: uploaded\.path/);
      expect(/photo_path:\s*(signed|url|http)/i.test(actions), file).toBe(false);
    }
  });

  it("shares the choreography and keeps the authorization apart", () => {
    // The storage half — upload, sign, delete, in the order rule 8 requires —
    // is genuinely one implementation and lives in `@/lib/storage/photos`.
    // **Deciding who may write is not**, and this is the assertion that keeps
    // the two from being collapsed by somebody tidying up:
    //
    //   a student's photograph   `students` is row-ownership, so the select
    //                            that resolves the person already returns
    //                            nothing to somebody who may not see the child
    //   a colleague's            `staff` is role-wide, so the select proves
    //                            nothing and `staff.view` is the only thing
    //                            between a librarian and the employment record
    //
    // Rule 4's refinement, and the same reason `getStaffCards` repeats the
    // check `staff_roster` makes.
    const shared = withoutComments(read("src/lib/storage/photos.ts"));
    expect(shared).toMatch(/createSignedUrls/);
    // Case-insensitive, which the first draft was not: planted as `forStudents`
    // it passed, because the regex looked for `students` and the identifier said
    // `Students`. A guard that only catches the spelling you happened to think
    // of is a guard you will trust for the wrong reason.
    expect(
      /hasPermission|current_role|students|staff/i.test(shared),
      "the shared storage module must not know which module is calling it",
    ).toBe(false);

    const staffActions = withoutComments(read("src/app/(app)/staff/photo-actions.ts"));
    expect(
      staffActions,
      "staff photo writes need their own gate: RLS on `staff` narrows nothing",
    ).toMatch(/hasPermission\("staff\.view"\)/);

    // The student one deliberately has none — the policy is the gate there, and
    // adding a permission check would be a second answer to a question RLS
    // already answers.
    const studentActions = withoutComments(read("src/app/(app)/students/photo-actions.ts"));
    expect(/hasPermission/.test(studentActions)).toBe(false);
  });

  it("takes its actions as props rather than importing one module's", () => {
    // A server action is a serialisable reference, so the shared control is
    // handed the pair belonging to whichever module rendered it. That is what
    // keeps the interface shared while the two selects stay apart.
    const control = withoutComments(read("src/components/people/photo-control.tsx"));
    expect(control).toMatch(/onUpload:/);
    expect(control).toMatch(/onRemove:/);
    for (const moduleSpecific of ["setStudentPhoto", "setStaffPhoto"]) {
      expect(
        control.includes(moduleSpecific),
        `the shared control must not import ${moduleSpecific}`,
      ).toBe(false);
    }
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
    const src = withoutComments(read("src/components/people/photo-control.tsx"));
    expect(
      /useI18n/.test(src),
      "PhotoControl must take its labels as props: calling useI18n() here pulls " +
        "the whole catalogue onto a route that has no other client-side consumer, " +
        "measured at +22 kB against +1 kB for props.",
    ).toBe(false);
    expect(src).toMatch(/labels: PhotoLabels/);
  });

  it("keeps the card face a Server Component", () => {
    // It takes `t` as a prop rather than calling a hook — rule 15's fourth
    // shape, and the one that shipped a blank screen for every teacher opening
    // their own week when a Server Component reached for `useI18n`.
    const src = read("src/components/id-card/id-card-sheet.tsx");
    expect(src.includes('"use client"'), "the card face ships no JavaScript").toBe(false);
    expect(src).toMatch(/t: Translator/);
  });

  it("keeps the face generic, so a second kind of card needs no second component", () => {
    // The face was student-shaped first — `admissionNumber`, `className`,
    // `rollNumber`, `guardianName` — and staff cards would have meant either a
    // second component or a type where half the fields are always null.
    // Neither survives a third kind of card (a visitor pass, an examiner's
    // temporary card), so it renders a `PersonCard`: a heading, a subtitle, and
    // a list of already-labelled facts.
    //
    // **Each module decides what a card says; this decides what one looks
    // like.** The labels arrive resolved because the module building a card
    // already holds `t`, and the face is a Server Component.
    const src = withoutComments(read("src/components/id-card/id-card-sheet.tsx"));
    expect(src).toMatch(/card: PersonCard/);
    // `className` is deliberately *not* in this list, and the omission is the
    // interesting part: it is both a student field and React's own prop, so
    // every `<div className=…>` in the file matches it. **A field name that
    // collides with a framework prop cannot be swept for by name** — asserting
    // it would report on the JSX rather than on the data shape, which is this
    // file's own lesson about prose applied to markup. `card.className` is
    // covered by `card: PersonCard` above: the type has no such property, so
    // reading one would not compile.
    for (const studentOnly of ["admissionNumber", "guardianName", "rollNumber", "dateOfBirth"]) {
      expect(
        src.includes(studentOnly),
        `the card face must not know about ${studentOnly}: a staff card has no such field`,
      ).toBe(false);
    }
  });
});

describe("the issues found by reading it back", () => {
  it("signs a whole class in one request, not one per child", () => {
    // The first version mapped the single-path signer over forty students:
    // forty server clients and forty HTTP round trips to Storage to render one
    // page. CLAUDE.md already names this in SQL — *"a scalar function that
    // queries another table is a correlated subquery wearing a nicer name...
    // resolve a set as a set"* — where `audit_actor_label` cost 8.4 ms per row.
    // Same shape in TypeScript.
    const actions = withoutComments(read("src/app/(app)/students/id-cards/actions.ts"));
    expect(actions).toMatch(/photoUrls\(/);
    expect(
      /rows\.map\(async/.test(actions),
      "the set path must not await per row — that is the per-row signer back again",
    ).toBe(false);

    // And the batch returns a map rather than an array, so a path that failed
    // to sign is absent rather than shifting every later child by one.
    const photo = withoutComments(read("src/lib/storage/photos.ts"));
    expect(photo).toMatch(/Promise<Map<string, string>>/);
    expect(photo).toMatch(/createSignedUrls/);
  });

  it("orders the roll numerically, because the column is text", () => {
    // `order by roll_number` on a text column returns 1, 10, 11, 2, 3 — and a
    // sheet of cards handed out in roll order is exactly where that is noticed.
    // Text is the right column type: `12A` and `VI-07` are both real.
    const actions = withoutComments(read("src/app/(app)/students/id-cards/actions.ts"));
    expect(
      /\.order\("roll_number"/.test(actions),
      "Postgres cannot sort a text roll number the way a register is called",
    ).toBe(false);
    expect(actions).toMatch(/numeric: true/);

    // The comparator itself, on the shapes that break a plain sort.
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    expect(["10", "2", "1"].sort((a, b) => collator.compare(a, b))).toEqual(["1", "2", "10"]);
    expect(["VI-10", "VI-7"].sort((a, b) => collator.compare(a, b))).toEqual(["VI-7", "VI-10"]);
    // Pinned to `en` deliberately: a roll number is an identifier, not a word,
    // and the order a class is called in must not depend on who printed it.
    expect(actions).toMatch(/Intl\.Collator\("en"/);
  });

  it("does not fetch a join it never reads", () => {
    // The select carried a nested `enrolments (...)` under each student that
    // `toCard` never touches — N x M rows for a projection that discards them.
    // Rule 7: the projection runs for every matching row, not every row
    // returned, so keep it cheap.
    const actions = withoutComments(read("src/app/(app)/students/id-cards/actions.ts"));
    // **The window has to be proved, not assumed.** The first draft ended this
    // slice at `indexOf("async function toCard")` — and `toCard` had just
    // stopped being async, so `indexOf` returned -1, `slice(start, -1)` ran to
    // the end of the file, and the assertion failed on `getIdCard`'s *singular*
    // query, which legitimately reads enrolments. A silent -1 widens a window
    // instead of emptying it, so both ends are checked before the slice is used.
    const from = actions.indexOf("export async function getIdCards");
    const to = actions.indexOf("function toCard(");
    expect(from, "getIdCards should still exist").toBeGreaterThan(-1);
    expect(to, "toCard should still exist").toBeGreaterThan(from);
    const setQuery = actions.slice(from, to);
    expect(
      /students!inner[\s\S]*?enrolments \(/.test(setQuery),
      "the set query must not re-fetch each student's enrolments: it already has " +
        "the one it is printing",
    ).toBe(false);
  });
});

describe("one school, read once", () => {
  it("has a single reader of school.profile", () => {
    // Written twice within a week — the student sheet and the staff sheet each
    // resolved the same setting into the same three fields, identical but for a
    // comment. `formatMoney`-under-four-names again, and CLAUDE.md's sentence
    // for it: *copies that agree cost nothing until the day one of them has to
    // change.* That day was already scheduled — this module's own *Not built*
    // wants a card back carrying the school's rules and an emergency number,
    // which is a third read of the same setting.
    //
    // It sits at the top level rather than under either card module because
    // `school.profile` is not an ID-card concept: the invoice document (0030)
    // and the certificate engine (0133) already read it in SQL.
    const roots = ["src/app", "src/components", "src/lib"];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of tsFiles(join(ROOT, root))) {
        if (file.endsWith("src/lib/school/identity.ts")) continue;
        const src = withoutComments(readFileSync(file, "utf8"));
        if (/setting_value[\s\S]{0,80}school\.profile/.test(src)) {
          offenders.push(file.replace(ROOT + "/", ""));
        }
      }
    }
    expect(
      offenders,
      "school.profile has one reader: @/lib/school/identity. A second copy is a " +
        "second answer the day somebody adds a field to the card.",
    ).toEqual([]);
  });
});

describe("a staff card carries its own gate", () => {
  it("checks staff.view in the function, not on the page", () => {
    // **The asymmetry, and it is the whole reason this is worth a test.**
    //
    // A student card needs no permission beyond the page's `students.view`,
    // because RLS on `students` is *row-ownership*: a class teacher printing
    // "their" class is narrowed to their own children by the policy, which is
    // the right answer and needs nothing else to produce it.
    //
    // RLS on `staff` is **role-wide** — admin, teacher, accountant and
    // librarian each read every row — so the policy narrows nothing and *"an
    // accountant may not pull the staff roster"* is a rule only
    // `role_permissions` expresses. Rule 4's refinement exactly.
    //
    // `staff_roster` already makes that check inside the function. This module
    // cannot simply call it (the roster returns no `photo_path`, and a card
    // without a photograph is not a card), so it **repeats** the gate. Skipping
    // it would have been invisible: the rows come back either way.
    const actions = withoutComments(read("src/app/(app)/staff/id-cards/actions.ts"));
    expect(actions).toMatch(/hasPermission\("staff\.view"\)/);
    expect(actions).toMatch(/reason: "withheld"/);

    // Both entry points, not just the list: a single card is the same data.
    const list = actions.slice(actions.indexOf("export async function getStaffCards"));
    const single = actions.slice(actions.indexOf("export async function getStaffCard("));
    expect(list).toMatch(/staff\.view/);
    expect(single).toMatch(/staff\.view/);
  });

  it("prints no card for somebody who has left", () => {
    // A departed teacher's badge is a door that should not open — the
    // `student_exit` lesson pointed at a piece of plastic.
    const actions = withoutComments(read("src/app/(app)/staff/id-cards/actions.ts"));
    expect(actions).toMatch(/\.eq\("status", "active"\)/);
    const page = withoutComments(read("src/app/(app)/staff/[id]/page.tsx"));
    expect(page).toMatch(/!hasLeft && \(/);
  });

  it("signs staff photographs as a set too", () => {
    const actions = withoutComments(read("src/app/(app)/staff/id-cards/actions.ts"));
    expect(actions).toMatch(/photoUrls\(/);
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
