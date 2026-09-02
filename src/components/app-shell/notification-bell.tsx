import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A link with a count, not a dropdown preview.
 *
 * A preview needs its own fetch, its own empty and error states, and its own
 * mark-read behaviour — a second, subtly different inbox to keep in step with
 * the real one. The count is the part that actually changes behaviour ("is
 * there anything waiting for me"); reading is one click away either way.
 */
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const hasUnread = unreadCount > 0;
  const shown = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link
        href="/notifications"
        aria-label={
          hasUnread
            ? `Notifications, ${unreadCount} unread`
            : "Notifications, nothing unread"
        }
      >
        <Bell className="size-5" aria-hidden="true" />
        {hasUnread && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center font-mono text-[10px] font-semibold leading-4 text-primary-foreground"
          >
            {shown}
          </span>
        )}
      </Link>
    </Button>
  );
}
