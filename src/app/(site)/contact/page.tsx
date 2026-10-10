import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container, PageHero, Section } from "@/components/site/blocks";
import { APPLY_PATH, COLLEGE, LOGIN_PATH, addressOneLine, mapsUrl } from "@/lib/site/content";

export const metadata: Metadata = {
  title: "Contact",
  description: `Address, phone and directions for ${COLLEGE.name}, ${COLLEGE.city}.`,
};

export default function ContactPage() {
  // A line is drawn only when the college has given us the fact. An empty
  // "Email: —" row reads as an oversight; an absent one reads as nothing.
  const rows = [
    {
      icon: MapPin,
      label: "Address",
      body: (
        <address className="not-italic">
          {COLLEGE.name}
          <br />
          {addressOneLine()}
        </address>
      ),
    },
    {
      icon: Phone,
      label: "Phone",
      body: <a href={`tel:${COLLEGE.phone.tel}`} className="hover:text-primary">{COLLEGE.phone.display}</a>,
    },
    COLLEGE.email
      ? { icon: Mail, label: "Email", body: <a href={`mailto:${COLLEGE.email}`} className="hover:text-primary">{COLLEGE.email}</a> }
      : null,
    COLLEGE.officeHours ? { icon: Clock, label: "Office hours", body: COLLEGE.officeHours } : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <>
      <PageHero
        title="Contact"
        lead="Call the office, or come in. We are happy to talk through programmes and admission."
        trail={[{ href: "/contact", label: "Contact" }]}
      />
      <Section>
        <Container className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-xl border bg-card p-6 sm:p-8">
            <dl className="flex flex-col gap-6">
              {rows.map(({ icon: Icon, label, body }) => (
                <div key={label} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 font-medium">{body}</dd>
                  </div>
                </div>
              ))}
            </dl>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <a href={mapsUrl()} target="_blank" rel="noopener noreferrer">Get directions<span className="sr-only"> (opens in a new tab)</span></a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={`tel:${COLLEGE.phone.tel}`}>Call now</a>
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-xl border bg-card p-6">
              <h2 className="font-serif text-xl font-semibold tracking-tight">Thinking of applying?</h2>
              <p className="mt-2 text-sm text-muted-foreground">Start the online application. It takes a few minutes.</p>
              <Button asChild className="mt-4"><Link href={APPLY_PATH}>Apply now</Link></Button>
            </div>
            <div className="rounded-xl border bg-card p-6">
              <h2 className="font-serif text-xl font-semibold tracking-tight">Already with us?</h2>
              <p className="mt-2 text-sm text-muted-foreground">Students, parents and staff sign in to the portal for attendance, fees, homework and results.</p>
              <Button asChild variant="outline" className="mt-4"><Link href={LOGIN_PATH}>Portal login</Link></Button>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
