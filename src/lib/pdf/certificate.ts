import { Sheet, pdfFileName } from "./document";

/**
 * A certificate, as a file.
 *
 * ## It renders the row, and only the row
 *
 * Rule 12's sentence about this module is *preview computes; issue freezes* —
 * `certificate_issue` allocates the gapless serial, renders the wording once,
 * server-side, and writes the rendered text down. The web page that shows a
 * certificate already refuses to be clever about it: it prints
 * `certificates.body` and the `snapshot` beside it, looks no student up and
 * consults no template.
 *
 * **This file inherits that refusal, and the reason is sharper for a file than
 * for a screen.** A PDF outlives the session it was made in — it is attached to
 * an email, saved to a phone, forwarded to a board. If it recomputed anything,
 * two copies of one certificate could disagree while both looked authentic, and
 * the one that is wrong is whichever was produced later.
 *
 * So the only inputs are columns frozen at issue. There is no student lookup
 * here and there must never be one.
 */

export type CertificateDocument = {
  serialNo: string;
  kind: string;
  /** The label the product shows for `kind`, already translated by the caller. */
  kindLabel: string;
  issuedOn: string;
  body: string;
  status: string;
  cancelReason: string | null;
  cancelledOn: string | null;
  /** `certificates.snapshot` — the school's own details as they were on the day. */
  snapshot: Record<string, string | null>;
};

/**
 * What the file is called when it lands in somebody's downloads.
 *
 * The serial number first, because that is what a school files by and what the
 * register is sorted on — `CERT-2025-00001.pdf` sorts next to its neighbours in
 * any folder, which `bonafide-vivaan-verma.pdf` does not.
 */
export function certificateFileName(serialNo: string): string {
  return pdfFileName(serialNo);
}

export async function renderCertificate(doc: CertificateDocument): Promise<Uint8Array> {
  const sheet = await Sheet.create();
  const school = doc.snapshot["school.name"]?.trim() || "";
  const address = doc.snapshot["school.address"]?.trim() || "";

  if (school) sheet.text(school, { size: 17, leading: 1.25, align: "center" });
  if (address) {
    sheet.text(address, { size: 9.5, leading: 1.35, align: "center", tone: "quiet", above: 4 });
  }

  sheet.rule(16, 22);

  // The kind, spaced out in capitals — the one piece of typographic formality a
  // certificate earns, and the reason this renderer needs no bold face.
  sheet.text(doc.kindLabel.toLocaleUpperCase("en"), {
    size: 11,
    leading: 1.2,
    align: "center",
  });

  sheet.space(26);

  // A cancelled certificate keeps its serial and says so at the top, where
  // somebody holding the paper will see it before they read the claim it makes.
  // Striking the body through is not available in a PDF text run and would be
  // the wrong answer anyway: the document must stay legible, because the whole
  // point of keeping a cancelled one is being able to read what it said.
  if (doc.status === "cancelled") {
    sheet.text("CANCELLED", { size: 12, align: "center" });
    const reason = [doc.cancelReason?.trim(), doc.cancelledOn].filter(Boolean).join(" — ");
    if (reason) {
      sheet.text(reason, { size: 9.5, align: "center", tone: "quiet", above: 2 });
    }
    sheet.rule(14, 20);
  }

  // The frozen text. `leading: 1.75` because this is read once, slowly, by
  // somebody checking whether it says what they need it to say.
  sheet.text(doc.body, { size: 11, leading: 1.75 });

  sheet.signature("Principal");

  // The footer carries the two facts that identify the document rather than
  // describe it, on every page, because a certificate's second sheet separated
  // from its first is otherwise anonymous.
  return sheet.finish(`${doc.serialNo} · Issued ${doc.issuedOn}`);
}
