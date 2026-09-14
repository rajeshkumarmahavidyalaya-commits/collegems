import Link from "next/link";
import { FileQuestion, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getT } from "@/lib/i18n/server";

/**
 * The 404 twenty-one routes were already throwing, and none of them had.
 *
 * `notFound()` is called from every dynamic route in the app — a student, an
 * exam, an invoice, a payslip, a route, a certificate. Without a `not-found.tsx`
 * anywhere, all twenty-one landed on Next's built-in page: outside the app
 * shell, with no navigation, no theme and no way back. A person who clicked a
 * stale bookmark was simply ejected from the product.
 *
 * Because this lives inside `(app)`, the group layout still runs, so the shell,
 * the sidebar and the reader's language are all there and the page is a page of
 * this application rather than a dead end.
 *
 * ## The copy is deliberately uninformative, and that is the point
 *
 * Every one of the twenty-one is `... .eq("id", id).maybeSingle()` followed by
 * `if (!row) notFound()`. Under RLS **"there is no such row" and "that row is
 * not yours" are the same answer** — the policy simply returns nothing, and the
 * page cannot tell the two apart even if it wanted to.
 *
 * So this must not say *"that student does not exist"*. It would be wrong half
 * the time, and it would be a way of asking the question: a teacher iterating
 * over ids could learn which ones are real from which message came back. The
 * platform console already makes this argument about its own refusal — *"a
 * message that distinguished them would be a way of asking which addresses are
 * operator accounts"* — and this is the same sentence one layer down.
 */
export default async function AppNotFound() {
  const t = await getT();

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <span className="rounded-full bg-muted p-3">
          <FileQuestion className="size-6 text-muted-foreground" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-medium">{t("boundary.notFound.title")}</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{t("boundary.notFound.body")}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t("boundary.notFound.back")}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
