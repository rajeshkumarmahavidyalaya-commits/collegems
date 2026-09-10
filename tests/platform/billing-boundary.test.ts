import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Subscription billing, guarded by reading the source.
 *
 * Two flows of money run in opposite directions through this codebase:
 *
 *   a COLLEGE charges a FAMILY      razorpay-create-link + razorpay-webhook
 *   the PLATFORM charges a COLLEGE  platform-subscription-link + -webhook
 *
 * They are different merchant accounts. Sharing a secret between them would
 * make a signature bug in the fee webhook also a signature bug in the thing
 * that decides whether a school keeps its subscription, and would let a
 * college's own gateway credentials collect the platform's revenue.
 *
 * These checks need no database and no provider — which is the point, because
 * the DB-backed suites cannot run in every environment and this rule has to
 * hold in all of them.
 */

const ROOT = process.cwd();
const FUNCTIONS = join(ROOT, "supabase/functions");

const COLLEGE_FNS = ["razorpay-create-link", "razorpay-webhook"];
const PLATFORM_FNS = ["platform-subscription-link", "platform-subscription-webhook"];

function fnSource(name: string): string {
  const p = join(FUNCTIONS, name, "index.ts");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

function appFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      appFiles(p, acc);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      acc.push(p);
    }
  }
  return acc;
}

describe("the platform's money and a college's money stay apart", () => {
  it("keeps both sets of Edge Functions in the tree", () => {
    // The sanity check first: if a rename makes `fnSource` return "", every
    // assertion below passes on an empty string.
    for (const name of [...COLLEGE_FNS, ...PLATFORM_FNS]) {
      expect(fnSource(name).length, `${name}/index.ts should exist`).toBeGreaterThan(500);
    }
  });

  it("never lets a platform function read a college's gateway secret", () => {
    const offenders: string[] = [];

    for (const name of PLATFORM_FNS) {
      const src = fnSource(name);
      // `RAZORPAY_KEY_ID` etc. are the COLLEGE's keys. The platform's are
      // prefixed, so a bare reference is the leak — matched with a boundary
      // that a `PLATFORM_` prefix does not satisfy.
      for (const m of src.matchAll(/(?<![A-Z_])RAZORPAY_[A-Z_]+/g)) {
        offenders.push(`${name}: ${m[0]}`);
      }
    }

    expect(
      offenders,
      "A platform-billing function must read PLATFORM_RAZORPAY_* only. Sharing " +
        "the college's merchant credentials would collect subscription revenue " +
        "into a college's own account.",
    ).toEqual([]);
  });

  it("never lets a college function read the platform's gateway secret", () => {
    const offenders: string[] = [];

    for (const name of COLLEGE_FNS) {
      const src = fnSource(name);
      for (const m of src.matchAll(/PLATFORM_RAZORPAY_[A-Z_]+/g)) {
        offenders.push(`${name}: ${m[0]}`);
      }
    }

    expect(offenders, "The fee functions must not hold the platform's credentials.").toEqual([]);
  });

  it("never reads a gateway secret from the Next.js app", () => {
    // Rule 6's oldest sentence, checked rather than trusted — and the check has
    // to ask the right question. The first draft matched the *name* anywhere in
    // `src/` and failed on `/fees/setup`, which tells an administrator, in
    // prose, that `RAZORPAY_KEY_SECRET` lives on the Edge Functions and never
    // here. That paragraph is the rule being explained to the person who has to
    // follow it; forbidding it would delete the documentation to satisfy the
    // guard.
    //
    // What is actually forbidden is a *read*: `process.env.RAZORPAY_…`,
    // `env("RAZORPAY_…")`, a `NEXT_PUBLIC_` twin. Naming one is fine; reaching
    // for its value is not.
    const offenders: string[] = [];
    const READS = [
      /process\.env\s*(?:\.\s*|\[\s*["'`])(?:PLATFORM_)?RAZORPAY_[A-Z_]+/g,
      /Deno\.env\.get\(\s*["'`](?:PLATFORM_)?RAZORPAY_[A-Z_]+/g,
      /NEXT_PUBLIC_[A-Z_]*RAZORPAY[A-Z_]*/g,
    ];

    for (const file of appFiles(join(ROOT, "src"))) {
      const body = readFileSync(file, "utf8");
      for (const pattern of READS) {
        for (const m of body.matchAll(pattern)) {
          offenders.push(`${file.slice(ROOT.length + 1)}: ${m[0]}`);
        }
      }
    }

    expect(
      offenders,
      "No gateway credential may be read in src/. The app creates a payment " +
        "intent; an Edge Function holds the key and turns it into a link. That " +
        "split is the whole reason the function exists.",
    ).toEqual([]);
  });

  it("verifies the signature before parsing, in both webhooks", () => {
    // Parsing and re-serialising changes the bytes and breaks the HMAC, and
    // "the signature kept failing so I compared the parsed object instead" is
    // exactly how this check gets removed. Both webhooks read the raw text,
    // verify, and only then parse — so `JSON.parse` must come after the
    // comparison in the file.
    for (const name of ["razorpay-webhook", "platform-subscription-webhook"]) {
      const src = fnSource(name);
      const verified = src.indexOf("timingSafeEqual(provided");
      const parsed = src.indexOf("JSON.parse(raw)");

      expect(verified, `${name} should compare the signature in constant time`).toBeGreaterThan(-1);
      expect(parsed, `${name} should parse the raw body`).toBeGreaterThan(-1);
      expect(
        parsed,
        `${name} must verify the signature before parsing the body — parsing first ` +
          `is how the HMAC stops being over the bytes that were signed.`,
      ).toBeGreaterThan(verified);
    }
  });

  it("fails closed when a webhook secret is unset", () => {
    for (const name of ["razorpay-webhook", "platform-subscription-webhook"]) {
      const src = fnSource(name);
      // A missing secret must refuse the callback, never skip the check. 503
      // rather than 200: an unconfigured deployment has not "handled" anything.
      expect(src, `${name} should refuse callbacks when its secret is unset`).toMatch(
        /if \(!secret\)[\s\S]{0,400}?503/,
      );
    }
  });

  it("takes the charged amount from the catalogue, not from the callback", () => {
    // The database re-reads `reference.plans.price_minor` and refuses a
    // mismatch (migration 0214), which is what makes a forged body unable to
    // decide what a college paid. The webhook passes the provider's figure
    // through for that comparison and does no arithmetic on it — a divide by
    // 100 in the middle is where a rounding argument starts.
    const src = fnSource("platform-subscription-webhook");
    expect(src).toContain("p_amount_minor");
    expect(
      /p_amount_minor:[^,]*\/\s*100/.test(src),
      "the subscription webhook must not convert the amount — the database " +
        "compares it against the plan's own price_minor",
    ).toBe(false);
  });
});
