import Link from "next/link";
import { CheckCircle2, Paperclip, Pin, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserContext } from "@/lib/auth/context";
import { getBoard } from "./actions";
import { categoryLabel, categoryTone } from "@/lib/validations/notices";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";

export const metadata = { title: "Notice board" };

/**
 * The board.
 *
 * What is on it is decided by the RLS policy, including the audience test — a
 * parent addressed by a Grade 4 circular can read that row and a parent who is
 * not cannot, in Postgres. So there is no filtering in this file and no
 * `if (role === …)`: adding one would be a second answer to a question that
 * already has one, and the second answer is the one that goes wrong.
 */
export default async function NoticesPage() {
  const [notices, ctx, locale] = await Promise.all([getBoard(), getUserContext(), getLocale()]);
  const canWrite = ctx?.roleCode === "admin";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notice board</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Circulars and announcements, kept so they can be read again. You are only shown the
            ones addressed to you.
          </p>
        </div>
        {canWrite && (
          <Button asChild>
            <Link href="/notices/manage">Write and manage notices</Link>
          </Button>
        )}
      </div>

      {notices.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="size-4 text-muted-foreground" aria-hidden="true" />
              Nothing on the board
            </CardTitle>
            <CardDescription>
              {canWrite
                ? "Nothing has been published yet. A notice stays here after it is announced, so it can be read again."
                : "There are no notices for you at the moment."}
            </CardDescription>
          </CardHeader>
          {canWrite && (
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/notices/manage">Write the first one</Link>
              </Button>
            </CardContent>
          )}
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {notices.map((notice) => (
            <li key={notice.id}>
              <Link
                href={`/notices/${notice.id}`}
                className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-2 font-medium">
                      {notice.isPinned && (
                        <Pin className="size-3.5 text-warning" aria-label="Pinned" />
                      )}
                      {notice.title}
                      <Badge variant={categoryTone(notice.category)}>
                        {categoryLabel(notice.category)}
                      </Badge>
                    </h2>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{notice.body}</p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                    {notice.publishedAt && (
                      <time dateTime={notice.publishedAt}>
                        {formatDate(notice.publishedAt, locale)}
                      </time>
                    )}
                    <span className="flex items-center gap-2">
                      {notice.attachments > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="size-3" aria-hidden="true" />
                          {notice.attachments}
                        </span>
                      )}
                      {/* Read state is a word plus an icon, never the icon
                          alone: "seen" and "not seen" must not be a colour. */}
                      {notice.isRead ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CheckCircle2 className="size-3" aria-hidden="true" />
                          Read
                        </span>
                      ) : (
                        <span className="font-medium text-foreground">New</span>
                      )}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
