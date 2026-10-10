import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Container, PageHero, Section } from "@/components/site/blocks";
import { APPLY_PATH, COLLEGE, PROGRAMMES, programmeBySlug } from "@/lib/site/content";

type Params = { slug: string };

// Four known programmes: build them at deploy time. An unknown slug is a 404,
// not a render, so `dynamicParams` stays off.
export const dynamicParams = false;
export function generateStaticParams(): Params[] {
  return PROGRAMMES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const p = programmeBySlug(slug);
  return p ? { title: p.name, description: p.summary } : {};
}

export default async function ProgrammePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const p = programmeBySlug(slug);
  if (!p) notFound();

  const facts: [string, string][] = [
    ["Level", p.level],
    ["Duration", p.duration],
    ["Mode", "Full-time"],
    ...(p.seats ? ([["Approved seats", String(p.seats)]] as [string, string][]) : []),
    ["Affiliation", COLLEGE.affiliationShort],
  ];

  return (
    <>
      <PageHero
        title={p.name}
        lead={p.summary}
        trail={[
          { href: "/programmes", label: "Programmes" },
          { href: `/programmes/${p.slug}`, label: p.short },
        ]}
      />

      <Section>
        <Container className="grid gap-12 lg:grid-cols-[1.5fr_1fr]">
          <div className="flex max-w-2xl flex-col gap-10">
            <div>
              <h2 className="font-serif text-2xl font-semibold tracking-tight">Eligibility</h2>
              <p className="mt-3 text-muted-foreground">{p.eligibility}</p>
            </div>
            <div>
              <h2 className="font-serif text-2xl font-semibold tracking-tight">How selection works</h2>
              <p className="mt-3 text-muted-foreground">{p.selection}</p>
            </div>
            {p.approval ? (
              <div>
                <h2 className="font-serif text-2xl font-semibold tracking-tight">Approval</h2>
                <p className="mt-3 text-muted-foreground">{p.approval}</p>
              </div>
            ) : null}
            <p className="rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground">
              Seats, fees and dates are set every session. Call{" "}
              <a href={`tel:${COLLEGE.phone.tel}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                {COLLEGE.phone.display}
              </a>{" "}
              to confirm the current notice before you apply.
            </p>
          </div>

          <aside aria-labelledby="facts" className="h-fit rounded-xl border bg-card p-6">
            <h2 id="facts" className="mb-4 text-sm font-semibold">Programme facts</h2>
            <dl className="divide-y">
              {facts.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-3 first:pt-0">
                  <dt className="text-sm text-muted-foreground">{k}</dt>
                  <dd className="text-end text-sm font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <Button asChild size="lg" className="mt-2 w-full">
              <Link href={APPLY_PATH}>Apply for {p.short}</Link>
            </Button>
          </aside>
        </Container>
      </Section>
    </>
  );
}
