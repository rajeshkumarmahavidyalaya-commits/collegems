import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/site/blocks";

// The website's own 404. The ERP's (`(app)/not-found.tsx`) sits inside a
// signed-in shell this group does not have, so a stale link to a programme
// would otherwise land on Next's bare default with no way back.
//
// The copy claims nothing about whether the page ever existed.
export default function SiteNotFound() {
  return (
    <Container className="flex flex-col items-start gap-5 py-24">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="font-serif text-4xl font-semibold tracking-tight text-balance">We could not find that page</h1>
      <p className="max-w-md text-muted-foreground">The address may be mistyped or out of date. Start from the home page, or look at our programmes.</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild><Link href="/">Go to home</Link></Button>
        <Button asChild variant="outline"><Link href="/programmes">Programmes</Link></Button>
      </div>
    </Container>
  );
}
