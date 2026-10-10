import Link from "next/link";
import { MapPin, Phone } from "lucide-react";
import { SiteLogo } from "@/components/site/site-header";
import { APPLY_PATH, COLLEGE, LOGIN_PATH, NAV, PROGRAMMES, addressOneLine, mapsUrl } from "@/lib/site/content";

const linkClass = "text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none rounded-sm";

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/40">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div className="flex flex-col gap-4">
          <SiteLogo />
          <p className="max-w-xs text-sm text-muted-foreground">
            Affiliated to {COLLEGE.affiliation}. Teacher education approved by {COLLEGE.approval}.
          </p>
        </div>

        <nav aria-label="Explore" className="flex flex-col gap-2.5">
          <h2 className="text-sm font-semibold">Explore</h2>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={linkClass}>{n.label}</Link>
          ))}
          <Link href={LOGIN_PATH} className={linkClass}>Portal login</Link>
        </nav>

        <nav aria-label="Programmes" className="flex flex-col gap-2.5">
          <h2 className="text-sm font-semibold">Programmes</h2>
          {PROGRAMMES.map((p) => (
            <Link key={p.slug} href={`/programmes/${p.slug}`} className={linkClass}>{p.short}</Link>
          ))}
          <Link href={APPLY_PATH} className={linkClass}>Apply online</Link>
        </nav>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Visit or call</h2>
          <address className="flex gap-2 text-sm not-italic text-muted-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {addressOneLine()}
              <br />
              <a href={mapsUrl()} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
                Get directions<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </span>
          </address>
          <a href={`tel:${COLLEGE.phone.tel}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <Phone className="size-4 shrink-0" aria-hidden="true" />
            {COLLEGE.phone.display}
          </a>
        </div>
      </div>

      <div className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} {COLLEGE.name}, {COLLEGE.city}. All rights reserved.</p>
          <p>Established {COLLEGE.established}</p>
        </div>
      </div>
    </footer>
  );
}
