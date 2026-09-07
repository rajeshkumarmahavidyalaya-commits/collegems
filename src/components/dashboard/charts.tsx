"use client";

import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DonutDatum } from "./donut-chart";
import type { EnrollmentDatum } from "./enrollment-chart";

/**
 * The charts, loaded after the page is on screen.
 *
 * Recharts is a 404 kB chunk and it was in the dashboard's first load —
 * the first page every user sees after signing in, which made it the
 * heaviest route in the app at 235 kB while every other page sat near 200.
 * Nothing above the fold needs it: the figures a head teacher actually reads
 * are the stat cards, and the bars are a picture of a number that is already
 * on the screen in words.
 *
 * `ssr: false` because a chart has nothing to contribute to the HTML — Recharts
 * measures its container before it can draw, so server-rendering it produces
 * markup the client throws away. That is also why this file exists at all:
 * `ssr: false` is not allowed in a Server Component, so the dynamic import
 * lives behind a client boundary and the page stays a Server Component.
 *
 * The skeleton is the same height as the chart, so nothing below it moves when
 * the bars arrive.
 */

function ChartSkeleton() {
  return (
    <Card>
      <CardHeader className="gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-72 w-full" />
      </CardContent>
    </Card>
  );
}

const LazyEnrollmentChart = dynamic(
  () => import("./enrollment-chart").then((m) => m.EnrollmentChart),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

const LazyDonutChart = dynamic(() => import("./donut-chart").then((m) => m.DonutChart), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

export function EnrollmentChartLazy({ data }: { data: EnrollmentDatum[] }) {
  return <LazyEnrollmentChart data={data} />;
}

export function DonutChartLazy({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: DonutDatum[];
}) {
  return <LazyDonutChart title={title} description={description} data={data} />;
}
