"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellOff, Check, CheckCheck, Loader2, MailOpen } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { relativeTime } from "@/lib/validations/notifications";
import { markAllRead, markRead, type InboxRow } from "./actions";

/**
 * An inbox, not a table. These are messages a person reads once and then wants
 * out of the way, so the primitives that make a data table good — sorting,
 * column visibility, pagination controls — are all wrong here. Newest first,
 * unread visually first-class, one click to clear.
 */
export function NotificationInbox({ rows }: { rows: InboxRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const unreadCount = useMemo(() => rows.filter((r) => !r.readAt).length, [rows]);
  const visible = filter === "unread" ? rows.filter((r) => !r.readAt) : rows;

  function open(row: InboxRow) {
    setExpanded((current) => (current === row.id ? null : row.id));

    // Opening is what marks a message read — an explicit "mark as read" button
    // on every row is a second click for something the first click already
    // meant.
    if (!row.readAt) {
      startTransition(async () => {
        const result = await markRead(row.id);
        if (!result.ok) toast.error(result.error);
        else router.refresh();
      });
    }
  }

  function clearAll() {
    startTransition(async () => {
      const result = await markAllRead();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.count === 0
          ? "Nothing was unread."
          : `Marked ${result.data.count} ${result.data.count === 1 ? "message" : "messages"} read.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as "unread" | "all")}>
          <TabsList>
            <TabsTrigger value="unread">
              Unread
              {unreadCount > 0 && (
                <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] leading-none text-primary-foreground">
                  {unreadCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        <Button variant="outline" size="sm" onClick={clearAll} disabled={pending || unreadCount === 0}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCheck className="size-4" aria-hidden="true" />
          )}
          Mark all read
        </Button>
      </div>

      <p aria-live="polite" className="sr-only">
        {visible.length} {visible.length === 1 ? "message" : "messages"} shown,{" "}
        {unreadCount} unread.
      </p>

      {visible.length === 0 ? (
        <EmptyInbox filter={filter} onShowAll={() => setFilter("all")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((row) => {
            const isOpen = expanded === row.id;
            const isUnread = !row.readAt;

            return (
              <li key={row.id}>
                <Card
                  className={cn(
                    "transition-colors",
                    isUnread && "border-primary/40 bg-primary/[0.03] dark:bg-primary/[0.06]",
                  )}
                >
                  <CardContent className="p-0">
                    <button
                      type="button"
                      onClick={() => open(row)}
                      aria-expanded={isOpen}
                      className="flex w-full flex-col gap-1.5 rounded-lg p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="font-normal">
                          {row.eventName}
                        </Badge>
                        {/* Text, not a coloured dot: "Unread" has to survive
                            being read aloud and being seen without colour. */}
                        {isUnread ? (
                          <Badge className="gap-1">
                            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                            Unread
                          </Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Check className="size-3" aria-hidden="true" />
                            Read
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          <time dateTime={row.createdAt} title={new Date(row.createdAt).toLocaleString("en-IN")}>
                            {relativeTime(row.createdAt)}
                          </time>
                        </span>
                      </div>

                      {row.subject && (
                        <p className={cn("text-sm", isUnread ? "font-semibold" : "font-medium")}>
                          {row.subject}
                        </p>
                      )}

                      <p
                        className={cn(
                          "text-sm text-muted-foreground",
                          !isOpen && "line-clamp-2",
                          isOpen && "whitespace-pre-wrap",
                        )}
                      >
                        {row.body}
                      </p>
                    </button>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyInbox({ filter, onShowAll }: { filter: "unread" | "all"; onShowAll: () => void }) {
  const isUnread = filter === "unread";
  const Icon = isUnread ? MailOpen : BellOff;

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <span className="rounded-full bg-muted p-3">
          <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
        </span>
        <div>
          <p className="font-medium">{isUnread ? "You are all caught up" : "No messages yet"}</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {isUnread
              ? "Nothing is waiting to be read."
              : "Announcements, fee receipts and absence notices will arrive here."}
          </p>
        </div>
        {isUnread && (
          <Button variant="outline" size="sm" onClick={onShowAll}>
            Show everything
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
