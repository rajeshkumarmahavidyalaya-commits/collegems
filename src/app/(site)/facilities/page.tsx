import type { Metadata } from "next";
import {
  BookOpen,
  Building2,
  FlaskConical,
  HeartPulse,
  Laptop,
  Presentation,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { Container, PageHero, Section } from "@/components/site/blocks";
import { COLLEGE, FACILITIES } from "@/lib/site/content";

export const metadata: Metadata = {
  title: "Facilities",
  description: "Library, laboratories, IT lab, auditorium, sports and medical support on the Rajesh Kumar Mahavidyalaya campus.",
};

const ICONS: Record<string, LucideIcon> = {
  library: BookOpen,
  labs: FlaskConical,
  it: Laptop,
  auditorium: Presentation,
  sports: Trophy,
  medical: HeartPulse,
};

export default function FacilitiesPage() {
  return (
    <>
      <PageHero
        title="Facilities"
        lead={`Everything a day of study needs, on a ${COLLEGE.campusAcres}-acre campus.`}
        trail={[{ href: "/facilities", label: "Facilities" }]}
      />
      <Section>
        <Container>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FACILITIES.map((f) => {
              const Icon = ICONS[f.key] ?? Building2;
              return (
                <li key={f.key} className="flex flex-col gap-4 rounded-xl border bg-card p-6">
                  <span className="grid size-11 place-items-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="font-serif text-xl font-semibold tracking-tight">{f.title}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Container>
      </Section>
    </>
  );
}
