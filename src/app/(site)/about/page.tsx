import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Container, PageHero, Section } from "@/components/site/blocks";
import { APPLY_PATH, COLLEGE } from "@/lib/site/content";

export const metadata: Metadata = {
  title: "About",
  description: `${COLLEGE.name} is a co-educational college in ${COLLEGE.city}, established in ${COLLEGE.established} and affiliated to ${COLLEGE.affiliation}.`,
};

const AT_A_GLANCE = [
  ["Established", String(COLLEGE.established)],
  ["Type", COLLEGE.type],
  ["Affiliation", COLLEGE.affiliation],
  ["Approval", `${COLLEGE.approval} (teacher education)`],
  ["Campus", `${COLLEGE.campusAcres} acres`],
  ["Location", `${COLLEGE.city}, ${COLLEGE.state}`],
] as const;

export default function AboutPage() {
  return (
    <>
      <PageHero
        title="About the college"
        lead={`A co-educational college in ${COLLEGE.city}, teaching since ${COLLEGE.established}.`}
        trail={[{ href: "/about", label: "About" }]}
      />

      <Section>
        <Container className="grid gap-12 lg:grid-cols-[1.5fr_1fr]">
          <div className="flex max-w-2xl flex-col gap-5 text-base text-muted-foreground text-pretty">
            <p>
              {COLLEGE.name} was established in {COLLEGE.established} to bring higher education and teacher
              training within reach of students in {COLLEGE.city} and the villages around it. It is affiliated to{" "}
              {COLLEGE.affiliation}, and its B.Ed. programme is approved by the National Council for Teacher
              Education.
            </p>
            <p>
              The college offers knowledge across several fields: arts at the undergraduate level, sociology
              and home science at the postgraduate level, and professional preparation for school teachers.
            </p>
            <p>
              Learning is not confined to the lecture room. Workshops and seminars give students practical
              exposure, and the library, laboratories and IT lab on a {COLLEGE.campusAcres}-acre campus give
              them the room to practise it.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild>
                <Link href="/programmes">See programmes</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={APPLY_PATH}>Apply now</Link>
              </Button>
            </div>
          </div>

          <aside aria-labelledby="glance" className="h-fit rounded-xl border bg-card p-6">
            <h2 id="glance" className="mb-4 text-sm font-semibold">At a glance</h2>
            <dl className="divide-y">
              {AT_A_GLANCE.map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
                  <dd className="text-sm font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </Container>
      </Section>
    </>
  );
}
