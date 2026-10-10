import type { Metadata } from "next";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container, PageHero, Section, SectionHeading } from "@/components/site/blocks";
import { ADMISSION_STEPS, APPLY_PATH, COLLEGE, DOCUMENTS, FAQ, PROGRAMMES } from "@/lib/site/content";

export const metadata: Metadata = {
  title: "Admissions",
  description: "How to apply to Rajesh Kumar Mahavidyalaya: steps, eligibility, documents and answers to common questions.",
};

export default function AdmissionsPage() {
  return (
    <>
      <PageHero
        title="Admissions"
        lead="Choose a programme, apply, and the office guides you through the rest."
        trail={[{ href: "/admissions", label: "Admissions" }]}
      />

      <Section>
        <Container>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ADMISSION_STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border bg-card p-5">
                <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
                <h2 className="mt-4 font-semibold">{s.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href={APPLY_PATH}>Apply online</Link></Button>
            <Button asChild size="lg" variant="outline"><a href={`tel:${COLLEGE.phone.tel}`}>Call {COLLEGE.phone.display}</a></Button>
          </div>
        </Container>
      </Section>

      <Section tone="muted">
        <Container>
          <SectionHeading eyebrow="Eligibility" title="Who can apply for what" />
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[40rem] text-start text-sm">
              <caption className="sr-only">Eligibility and selection by programme</caption>
              <thead>
                <tr className="border-b bg-muted/60 text-start">
                  <th scope="col" className="px-4 py-3 text-start font-semibold">Programme</th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold">Eligibility</th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold">Selection</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {PROGRAMMES.map((p) => (
                  <tr key={p.slug} className="align-top">
                    <th scope="row" className="px-4 py-4 text-start font-medium">
                      <Link href={`/programmes/${p.slug}`} className="hover:text-primary">{p.short}</Link>
                      <span className="block text-xs font-normal text-muted-foreground">{p.duration}</span>
                    </th>
                    <td className="px-4 py-4 text-muted-foreground">{p.eligibility}</td>
                    <td className="px-4 py-4 text-muted-foreground">{p.selection}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      <Section>
        <Container className="grid gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Documents" title="What to bring" lead="The usual set. The office confirms the exact list for the session." />
            <ul className="flex flex-col gap-3">
              {DOCUMENTS.map((d) => (
                <li key={d} className="flex gap-3 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <SectionHeading eyebrow="Questions" title="Frequently asked" />
            <div className="divide-y rounded-xl border bg-card">
              {FAQ.map((f) => (
                <details key={f.q} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
