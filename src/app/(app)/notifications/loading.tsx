import { Skeleton } from "@/components/ui/skeleton";

/**
 * The inbox is the one screen in this app people open reflexively, so it gets a
 * shaped skeleton rather than the RSC default of nothing-then-everything. The
 * blocks match the real card sizes, so the page does not jump when it lands.
 */
export default function NotificationsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>

      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="ml-auto h-4 w-20" />
            </div>
            <Skeleton className="mt-3 h-4 w-56" />
            <Skeleton className="mt-2 h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
