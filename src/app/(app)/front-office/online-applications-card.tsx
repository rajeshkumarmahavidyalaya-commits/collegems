"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, ExternalLink, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OnlineApplications } from "./actions";

/**
 * Where the public application form is, or how to open it.
 *
 * Two states and both are sentences: *off* says where the switch is, and *on*
 * gives the address to copy onto the college's own website. Applications
 * arrive on the board below as **Website** enquiries with a follow-up due the
 * day they came in, so the card says so rather than leaving the office to
 * wonder where they go.
 */
export function OnlineApplicationsCard({
  online,
  canChange,
}: {
  online: OnlineApplications;
  canChange: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const address = online.url ?? online.path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard still shows the address, selectable.
    }
  }

  return (
    <section
      aria-labelledby="online-applications-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Globe className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="online-applications-heading" className="text-sm font-semibold">
            {online.enabled ? "Online applications are open" : "Online applications are off"}
          </h2>
          {online.enabled ? (
            <>
              <p className="text-sm text-muted-foreground">
                Families can apply without an account. Each application lands below as a{" "}
                <span className="font-medium text-foreground">Website</span> enquiry, due for a
                call back the day it arrives — at most {online.perHour} an hour.
              </p>
              <bdi className="font-mono text-sm break-all text-foreground select-all">{address}</bdi>
            </>
          ) : canChange ? (
            <p className="text-sm text-muted-foreground">
              Switch them on under <span className="font-medium text-foreground">Front office</span>{" "}
              in school settings, and this card will show the address to put on the college&apos;s
              website.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              An administrator can switch them on in school settings. Families could then apply
              from a public page, and each application would land on this board.
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {online.enabled ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              <span aria-live="polite">{copied ? "Copied" : "Copy address"}</span>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={online.path} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                Open the form
              </a>
            </Button>
          </>
        ) : canChange ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/school">Open settings</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
