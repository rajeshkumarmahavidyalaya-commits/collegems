import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, Eye, Megaphone, Paperclip, Pin } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserContext } from "@/lib/auth/context";
import { getNotice, listAttachments, markRead, readSummary } from "../actions";
import { AttachmentLink } from "./attachment-link";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import {
  categoryLabel,
  categoryTone,
  readRate,
  statusTone,
  STATUS_LABEL,
  type NoticeStatus,
} from "@/lib/validations/notices";

export const metadata = { title: "Notice" };

/**
 * One notice.
 *
 * The read receipt is written when this page renders rather than from a
 * button. A receipt that needs a click measures who pressed a button, which is
 * a different and much less useful fact than who opened the circular — and the
 * question a school actually asks is the second one.
 *
 * Writing during a render is deliberate and safe here: `notice_mark_read` is
 * idempotent on `(notice_id, user_id)` and never moves an existing `read_at`,
 * so a page refreshed thirty times is one receipt with its original timestamp.
 */
export default async function NoticePage({ params }: PageProps<"/notices/[id]">) {
  const { id } = await params;

  const [notice, ctx, locale, t] = await Promise.all([
    getNotice(id),
    getUserContext(),
    getLocale(),
    getT(),
  ]);
  if (!notice) notFound();

  await markRead(id);

  const isStaff = ["admin", "teacher"].includes(ctx?.roleCode ?? "");
  const [attachments, summary] = await Promise.all([
    listAttachments(id),
    isStaff ? readSummary(id) : Promise.resolve(null),
  ]);

  const rate = summary ? readRate(summary) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/notices"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          Notice board
        </Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {notice.is_pinned && <Pin className="size-4 text-warning" aria-label="Pinned" />}
          {notice.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={categoryTone(notice.category)}>{categoryLabel(notice.category, t)}</Badge>
          {notice.status !== "published" && (
            <Badge variant={statusTone(notice.status)}>
              {STATUS_LABEL[notice.status as NoticeStatus] ?? notice.status}
            </Badge>
          )}
          {notice.published_at && (
            <time dateTime={notice.published_at}>
              {formatDate(notice.published_at, locale)}
            </time>
          )}
        </div>
      </div>

      {notice.status === "withdrawn" && (
        <Alert variant="destructive">
          <Ban className="size-4" aria-hidden="true" />
          <AlertTitle>This notice has been withdrawn</AlertTitle>
          <AlertDescription>
            {notice.withdraw_reason}. It stays here, and so do the records of who had already read
            it — that is exactly the question somebody asks afterwards.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="whitespace-pre-wrap text-[15px] leading-7">{notice.body}</div>
        </CardContent>
      </Card>

      {attachments.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Paperclip className="size-4 text-muted-foreground" aria-hidden="true" />
              Attachments
            </CardTitle>
            <CardDescription>
              Each link is created when you ask for it and stops working shortly afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {attachments.map((file) => (
              <AttachmentLink
                key={file.id}
                fileId={file.id}
                fileName={file.file_name}
                sizeBytes={file.size_bytes}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {isStaff && summary && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="size-4 text-muted-foreground" aria-hidden="true" />
              Who has opened it
            </CardTitle>
            <CardDescription>
              The question a board can answer and a broadcast cannot.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Addressed to</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums">{summary.audience}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Opened</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums">{summary.read}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Share</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums">
                  {rate === null ? "—" : `${rate}%`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Announced</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums">
                  {summary.announced}
                </dd>
              </div>
            </dl>

            {summary.last_announce_error && (
              <Alert>
                <Megaphone className="size-4" aria-hidden="true" />
                <AlertTitle>The announcement did not go out</AlertTitle>
                <AlertDescription>
                  {summary.last_announce_error}. The notice is on the board either way — the board
                  is the point and the announcement is a courtesy.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
