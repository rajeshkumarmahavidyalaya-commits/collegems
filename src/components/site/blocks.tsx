import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** The width every section shares, so edges line up from header to footer. */
export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)} {...props} />;
}

export function Section({
  className,
  tone = "plain",
  ...props
}: React.ComponentProps<"section"> & { tone?: "plain" | "muted" }) {
  return (
    <section
      className={cn("py-16 sm:py-20", tone === "muted" && "border-y bg-muted/40", className)}
      {...props}
    />
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow ? <p className="mb-2 text-sm font-medium text-primary">{eyebrow}</p> : null}
        <h2 className="font-serif text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
        {lead ? <p className="mt-3 text-base text-muted-foreground text-pretty">{lead}</p> : null}
      </div>
      {action ? (
        <Link href={action.href} className="group inline-flex items-center gap-1.5 text-sm font-medium text-primary">
          {action.label}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

/** The top of every inner page: a title, a line under it, and a breadcrumb trail. */
export function PageHero({
  title,
  lead,
  trail,
}: {
  title: string;
  lead?: string;
  trail?: { href: string; label: string }[];
}) {
  return (
    <div className="border-b bg-[radial-gradient(60%_80%_at_90%_0%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent)]">
      <Container className="py-12 sm:py-16">
        {trail?.length ? (
          <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground">Home</Link>
            {trail.map((t) => (
              <span key={t.href} className="flex items-center gap-1.5">
                <span aria-hidden="true">/</span>
                <Link href={t.href} className="hover:text-foreground">{t.label}</Link>
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="max-w-3xl font-serif text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h1>
        {lead ? <p className="mt-4 max-w-2xl text-lg text-muted-foreground text-pretty">{lead}</p> : null}
      </Container>
    </div>
  );
}
