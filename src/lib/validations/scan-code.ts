/**
 * What the code on an identity card says, and how a scanner reads it back.
 *
 * **No imports**, because the scanner is a client component and this is all it
 * needs; the encoder, which does import a library, lives in
 * `src/lib/id-card/qr.ts` and runs only on the server.
 *
 * ## An opaque code, not a web address
 *
 * The tempting payload is a URL, so any phone camera opens the record. It is
 * refused on two counts:
 *
 * - **A card outlives a deployment.** It is laminated and carried for three
 *   years, and a URL printed on it is a claim about where this product will
 *   live in 2029. Rule 10 already says *"a URL is a fact about the deployment,
 *   not about the school"*, and here it would be a fact frozen into plastic.
 * - **It would add nothing to the boundary.** The code carries a record's id,
 *   which grants nothing: the scan screen routes to `/students/<id>` or
 *   `/staff/<id>`, and those pages read through RLS exactly as if the id had
 *   been typed. A guardian's phone that scans another child's card lands on a
 *   404, which rule 15's boundary note says must not even claim the record
 *   exists.
 *
 * So the payload is `sos:<kind>:<uuid>` -- short (48 characters: a version 4
 * code, 33 modules square at level M), versioned by its prefix, and
 * meaningless outside the product.
 */
export const SCAN_KINDS = ["student", "staff"] as const;
export type ScanKind = (typeof SCAN_KINDS)[number];

const PATTERN = /^sos:(student|staff):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function scanCodeFor(kind: ScanKind, id: string): string {
  return `sos:${kind}:${id.toLowerCase()}`;
}

/**
 * The card a code names, or null. Strict: anything that is not exactly this
 * product's payload -- a shop's barcode, a Wi-Fi code, a URL -- is refused
 * rather than guessed at, and the screen says it is not one of ours.
 */
export function parseScanCode(text: string): { kind: ScanKind; id: string } | null {
  const m = PATTERN.exec(text.trim().toLowerCase());
  return m ? { kind: m[1] as ScanKind, id: m[2] } : null;
}

/** Where a scanned card leads: the record page, which decides who may see it. */
export function scanTarget(code: { kind: ScanKind; id: string }): string {
  return code.kind === "student" ? `/students/${code.id}` : `/staff/${code.id}`;
}
