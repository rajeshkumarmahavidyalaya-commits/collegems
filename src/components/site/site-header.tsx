"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { APPLY_PATH, COLLEGE, LOGIN_PATH, NAV } from "@/lib/site/content";
import { cn } from "@/lib/utils";

export function SiteLogo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
        <GraduationCap className="size-5" aria-hidden="true" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="font-serif text-base font-semibold tracking-tight">{COLLEGE.name}</span>
        <span className="text-xs text-muted-foreground">{COLLEGE.city}, {COLLEGE.state}</span>
      </span>
    </Link>
  );
}

/**
 * `/home` is where a signed-out `/` is rewritten to, so it counts as the
 * root: nothing in the nav is highlighted there.
 */
function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <SiteLogo />

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none",
                  active && "bg-accent text-accent-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href={LOGIN_PATH}>Portal login</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href={APPLY_PATH}>Apply now</Link>
          </Button>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>{COLLEGE.name}</SheetTitle>
                <SheetDescription>{COLLEGE.city}, {COLLEGE.state}</SheetDescription>
              </SheetHeader>
              <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
                <SheetClose asChild>
                  <Link href="/" className="rounded-md px-3 py-2.5 text-base font-medium hover:bg-accent">Home</Link>
                </SheetClose>
                {NAV.map((item) => (
                  <SheetClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(pathname, item.href) ? "page" : undefined}
                      className={cn(
                        "rounded-md px-3 py-2.5 text-base font-medium hover:bg-accent",
                        isActive(pathname, item.href) && "bg-accent text-accent-foreground",
                      )}
                    >
                      {item.label}
                    </Link>
                  </SheetClose>
                ))}
              </nav>
              <SheetFooter>
                <SheetClose asChild>
                  <Button asChild size="lg"><Link href={APPLY_PATH}>Apply now</Link></Button>
                </SheetClose>
                <SheetClose asChild>
                  <Button asChild size="lg" variant="outline"><Link href={LOGIN_PATH}>Portal login</Link></Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
