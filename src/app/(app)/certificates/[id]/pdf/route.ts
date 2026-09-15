import { getCertificate } from "../../actions";
import { kindLabel } from "@/lib/validations/certificates";
import { getT } from "@/lib/i18n/server";
import { certificateFileName, renderCertificate } from "@/lib/pdf/certificate";
import { UnrenderableDocument } from "@/lib/pdf/document";

/**
 * The certificate, as a file.
 *
 * ## Why this is a route handler and not a Server Action
 *
 * A Server Action returns a value into a React tree. This returns **bytes with
 * a `Content-Type`**, which is what makes the browser save a file, the phone
 * open a viewer, and a future mail driver able to attach one. That is a
 * response, not a result.
 *
 * ## Who may have it
 *
 * `getCertificate` is `.eq("id", id).maybeSingle()` through the caller's own
 * client, so **RLS is the whole gate** — the same one the page two directories
 * up already trusts. There is no new permission, no service identity, and
 * deliberately no `certificates.view` check here: a second answer to a question
 * Postgres already answers is a second place to get it wrong, and this file
 * shows exactly what the page shows to exactly the people the page shows it to.
 *
 * ## Why no permission check is the *right* shape here, and not laziness
 *
 * The distinction rule 4 draws: the matrix does real work where RLS is
 * deliberately tenant-wide (`staff`, `people`), and does nothing where a policy
 * is already row-scoped. `certificates` is row-scoped. A guardian who may read
 * their own child's certificate may have the file; nobody else's select
 * returns a row, so nobody else's request produces one.
 *
 * ## 404, and the copy
 *
 * *"There is no such certificate"* and *"that certificate is not yours"* are
 * **the same answer** under RLS, so the body says neither. Iterating over ids
 * must not turn this into an oracle for which serials exist — the same decision
 * `(app)/not-found.tsx` already makes for every page.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const certificate = await getCertificate(id);
  if (!certificate) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const t = await getT();

  try {
    const bytes = await renderCertificate({
      serialNo: certificate.serial_no,
      kind: certificate.kind,
      kindLabel: kindLabel(certificate.kind, t),
      issuedOn: certificate.issued_on,
      body: certificate.body,
      status: certificate.status,
      cancelReason: certificate.cancel_reason,
      cancelledOn: certificate.cancelled_at ? certificate.cancelled_at.slice(0, 10) : null,
      snapshot: (certificate.snapshot ?? {}) as Record<string, string | null>,
    });

    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        // `attachment`, not `inline`: the point of this route is a file that
        // leaves the session. A browser that previews it still offers Save.
        "content-disposition": `attachment; filename="${certificateFileName(certificate.serial_no)}"`,
        // A certificate is frozen, so the bytes for one id never change — but
        // `private` is load-bearing, because a shared cache holding somebody's
        // leaving certificate is the storage rule's "never render a signed link
        // into a page" wearing an HTTP header.
        "cache-control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    if (error instanceof UnrenderableDocument) {
      // 422, not 500. The request was understood, the row is intact, and the
      // document is genuinely unprintable by this build — which is a fact about
      // the font, stated, rather than a failure to be retried.
      return new Response(error.message, {
        status: 422,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    throw error;
  }
}
