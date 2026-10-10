"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/site/blocks";

// The website's error floor. The pages read a file rather than a database, so
// this should be rare; it exists so that when it happens a visitor keeps the
// header, a retry and the college's phone number instead of a blank page.
export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container className="flex flex-col items-start gap-5 py-24" role="alert" aria-live="assertive">
      <h1 className="font-serif text-4xl font-semibold tracking-tight text-balance">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground">This page could not be shown. Please try again, or call the college office.</p>
      {error.digest ? <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline"><Link href="/">Go to home</Link></Button>
      </div>
    </Container>
  );
}
