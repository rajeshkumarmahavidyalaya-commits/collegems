import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Building2,
  FlaskConical,
  HeartPulse,
  Laptop,
  MapPin,
  Phone,
  Presentation,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container, Section, SectionHeading } from "@/components/site/blocks";
import {
  ADMISSION_STEPS,
  APPLY_PATH,
  COLLEGE,
  FACILITIES,
  PROGRAMMES,
  UPDATES,
  addressOneLine,
  mapsUrl,
} from "@/lib/site/content";

const FACILITY_ICONS: Record<string, LucideIcon> = {
  library: BookOpen,
  labs: FlaskConical,
  it: Laptop,
  auditorium: Presentation,
  sports: Trophy,
  medical: HeartPulse,
};

const FACTS = [
  { value: String(COLLEGE.established), label: "Established" },
  { value: COLLEGE.affiliationShort, label: "Affiliated university" },
  { value: COLLEGE.approval, label: "Approved for teacher education" },
  { value: `${COLLEGE.campusAcres} acres`, label: "Campus" },
] as const;

export default function HomePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollegeOrUniversity",
    name: COLLEGE.name,
    foundingDate: String(COLLEGE.established),
    telephone: COLLEGE.phone.tel,
    address: {
      "@type": "PostalAddress",
      streetAddress: COLLEGE.address.lines.join(", "),
      addressLocality: COLLEGE.address.city,
      addressRegion: COLLEGE.address.state,
      postalCode: COLLEGE.address.pin,
      addressCountry: "IN",
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Hero */}
      <div className="border-b bg-[radial-gradient(70%_90%_at_85%_0%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent)]">
        <Container className="grid gap-10 py-16 sm:py-24 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              {COLLEGE.city}, {COLLEGE.state} · Est. {COLLEGE.established}
            </p>
            <h1 className="font-serif text-5xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-6xl">
              {COLLEGE.tagline}
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground text-pretty">{COLLEGE.intro}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={APPLY_PATH}>Apply now <ArrowRight aria-hidden="true" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/programmes">Explore programmes</Link>
              </Button>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-sm">
            {FACTS.map((f) => (
              <div key={f.label} className="flex flex-col gap-1 bg-card p-5">
                <dd className="font-serif text-2xl font-semibold tracking-tight">{f.value}</dd>
                <dt className="text-sm text-muted-foreground">{f.label}</dt>
              </div>
            ))}
          </dl>
        </Container>
      </div>

      {/* Latest updates: drawn only when the college has published some. */}
      {UPDATES.length > 0 ? (
        <Section tone="muted" className="py-10 sm:py-10">
          <Container>
            <h2 className="mb-4 text-sm font-semibold">Latest updates</h2>
            <ul className="divide-y rounded-lg border bg-card">
              {UPDATES.map((u) => (
                <li key={u.title} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                  {u.href ? <Link href={u.href} className="font-medium hover:text-primary">{u.title}</Link> : <span className="font-medium">{u.title}</span>}
                  <time className="text-sm text-muted-foreground">{u.date}</time>
                </li>
              ))}
            </ul>
          </Container>
        </Section>
      ) : null}

      {/* Programmes */}
      <Section>
        <Container>
          <SectionHeading
            eyebrow="Programmes"
            title="Four ways to begin"
            lead="From a first degree to teacher training, each programme page says who can apply, how selection works and how long it takes."
            action={{ href: "/programmes", label: "All programmes" }}
          />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PROGRAMMES.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/programmes/${p.slug}`}
                  className="group flex h-full flex-col gap-3 rounded-xl border bg-card p-5 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring outline-none"
                >
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.level}</span>
                  <span className="font-serif text-2xl font-semibold tracking-tight">{p.short}</span>
                  <span className="text-sm text-muted-foreground">{p.name}</span>
                  <span className="mt-auto flex items-center justify-between pt-4 text-sm">
                    <span className="text-muted-foreground">{p.duration}</span>
                    <ArrowRight className="size-4 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* About */}
      <Section tone="muted">
        <Container className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="mb-2 text-sm font-medium text-primary">About the college</p>
            <h2 className="font-serif text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Teaching that stays close to the classroom
            </h2>
            <p className="mt-4 text-muted-foreground text-pretty">
              {COLLEGE.name} has served students in and around {COLLEGE.city} since {COLLEGE.established}. We offer
              knowledge across several fields and add workshops and seminars so that what is learnt in the
              lecture room is practised outside it.
            </p>
            <Button asChild variant="link" className="mt-2 px-0">
              <Link href="/about">Read more about us <ArrowRight aria-hidden="true" /></Link>
            </Button>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {["Co-educational", "Affiliated to VBSPU", "Approved by NCTE", "Five-acre campus"].map((t) => (
              <li key={t} className="rounded-lg border bg-card px-4 py-3 text-sm font-medium">{t}</li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* Facilities */}
      <Section>
        <Container>
          <SectionHeading
            eyebrow="Campus"
            title="What you will find here"
            action={{ href: "/facilities", label: "All facilities" }}
          />
          <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FACILITIES.map((f) => {
              const Icon = FACILITY_ICONS[f.key] ?? Building2;
              return (
                <li key={f.key} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Container>
      </Section>

      {/* Admissions */}
      <Section tone="muted">
        <Container>
          <SectionHeading
            eyebrow="Admissions"
            title="Applying takes four steps"
            action={{ href: "/admissions", label: "Admission details" }}
          />
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ADMISSION_STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border bg-card p-5">
                <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      {/* Visit */}
      <Section>
        <Container>
          <div className="flex flex-col gap-6 rounded-2xl bg-primary px-6 py-10 text-primary-foreground sm:px-10 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h2 className="font-serif text-3xl font-semibold tracking-tight text-balance">Come and see the campus</h2>
              <p className="mt-3 flex items-start gap-2 text-sm opacity-90">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {addressOneLine()}
              </p>
              <p className="mt-2 flex items-center gap-2 text-sm opacity-90">
                <Phone className="size-4 shrink-0" aria-hidden="true" />
                <a href={`tel:${COLLEGE.phone.tel}`} className="underline-offset-4 hover:underline">{COLLEGE.phone.display}</a>
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" variant="secondary">
                <a href={mapsUrl()} target="_blank" rel="noopener noreferrer">Get directions<span className="sr-only"> (opens in a new tab)</span></a>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
                <Link href="/contact">Contact us</Link>
              </Button>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
