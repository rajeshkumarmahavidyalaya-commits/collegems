import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock, GraduationCap } from "lucide-react";
import { Container, PageHero, Section } from "@/components/site/blocks";
import { PROGRAMMES } from "@/lib/site/content";

export const metadata: Metadata = {
  title: "Programmes",
  description: "B.A., B.Ed., M.A. Sociology and M.A. Home Science at Rajesh Kumar Mahavidyalaya, Jaunpur.",
};

export default function ProgrammesPage() {
  return (
    <>
      <PageHero
        title="Programmes"
        lead="Undergraduate, postgraduate and teacher-education courses, all full-time."
        trail={[{ href: "/programmes", label: "Programmes" }]}
      />
      <Section>
        <Container>
          <ul className="grid gap-5 md:grid-cols-2">
            {PROGRAMMES.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/programmes/${p.slug}`}
                  className="group flex h-full flex-col gap-4 rounded-xl border bg-card p-6 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring outline-none"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.level}</p>
                      <h2 className="mt-1 font-serif text-2xl font-semibold tracking-tight">{p.name}</h2>
                    </div>
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                      <GraduationCap className="size-5" aria-hidden="true" />
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{p.summary}</p>
                  <div className="mt-auto flex items-center justify-between pt-2 text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="size-4" aria-hidden="true" />
                      {p.duration}
                      {p.seats ? ` · ${p.seats} seats` : ""}
                    </span>
                    <span className="flex items-center gap-1 font-medium text-primary">
                      Details <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </Section>
    </>
  );
}
