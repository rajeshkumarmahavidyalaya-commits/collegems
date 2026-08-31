"use client";

import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const LABELS: Record<string, string> = {
  library: "Library",
  books: "Catalog",
  members: "Members",
  issues: "Issues & returns",
  new: "New",
  edit: "Edit",
};

function labelFor(segment: string) {
  if (LABELS[segment]) return LABELS[segment];
  // Looks like an id (uuid) -- render a generic "Details" crumb instead.
  if (/^[0-9a-f-]{16,}$/i.test(segment)) return "Details";
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function AppBreadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Dashboard</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  let href = "";
  const crumbs = segments.map((segment, i) => {
    href += `/${segment}`;
    return { href, label: labelFor(segment), isLast: i === segments.length - 1 };
  });

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="hidden sm:block">
          <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="hidden sm:block" />
        {crumbs.map((crumb) => (
          <span key={crumb.href} className="flex items-center gap-1.5 sm:gap-2.5">
            <BreadcrumbItem>
              {crumb.isLast ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {!crumb.isLast && <BreadcrumbSeparator />}
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
