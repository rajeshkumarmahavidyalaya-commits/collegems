"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, Loader2, Megaphone, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { announceAgain, publishNotice, saveNotice, withdrawNotice } from "../actions";
import {
  categoryLabel,
  categoryTone,
  NOTICE_CATEGORIES,
  publishSentence,
  statusTone,
  STATUS_LABEL,
  type NoticeCategory,
  type NoticeStatus,
} from "@/lib/validations/notices";

type NoticeRow = {
  id: string;
  title: string;
  category: string;
  audience: unknown;
  status: string;
  is_pinned: boolean;
  published_at: string | null;
  announced_count: number;
  last_announce_error: string | null;
  starts_on: string | null;
  expires_on: string | null;
  withdraw_reason: string | null;
};

type Section = { id: string; label: string };
type Role = { code: string; name: string };

export function ManageNotices({
  notices,
  sections,
  roles,
}: {
  notices: NoticeRow[];
  sections: Section[];
  roles: Role[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <NewNotice sections={sections} roles={roles} />
      </div>

      {notices.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nothing written yet</CardTitle>
            <CardDescription>
              A notice is a draft until you publish it. Publishing puts it on the board and sends
              one message; nothing you do to it afterwards sends another.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        notices.map((notice) => <NoticeRowCard key={notice.id} notice={notice} />)
      )}
    </div>
  );
}

function NoticeRowCard({ notice }: { notice: NoticeRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function publish() {
    startTransition(async () => {
      const result = await publishNotice(notice.id);
      if (result.ok) {
        // The server's sentence, not one assembled here: "published but nobody
        // was notified" and "published and announced" are different facts and
        // only the database knows which happened.
        toast.success(publishSentence(result.data));
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function announce() {
    startTransition(async () => {
      const result = await announceAgain(notice.id);
      if (result.ok) {
        toast[result.data.announced ? "success" : "error"](
          result.data.announced
            ? "Announced again."
            : (result.data.error ?? "Nothing could be sent."),
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Link href={`/notices/${notice.id}`} className="underline-offset-4 hover:underline">
                {notice.title}
              </Link>
              <Badge variant={categoryTone(notice.category)}>
                {categoryLabel(notice.category)}
              </Badge>
              <Badge variant={statusTone(notice.status)}>
                {STATUS_LABEL[notice.status as NoticeStatus] ?? notice.status}
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              {notice.announced_count === 0
                ? "Not announced yet."
                : `Announced ${notice.announced_count} time${notice.announced_count === 1 ? "" : "s"}.`}
              {notice.last_announce_error && ` Last attempt: ${notice.last_announce_error}`}
              {notice.withdraw_reason && ` Withdrawn: ${notice.withdraw_reason}`}
            </CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
            {notice.status !== "published" && (
              <Button size="sm" onClick={publish} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-3.5" aria-hidden="true" />
                )}
                Publish
              </Button>
            )}
            {notice.status === "published" && (
              <>
                <Button size="sm" variant="outline" onClick={announce} disabled={pending}>
                  <Megaphone className="size-3.5" aria-hidden="true" />
                  Announce again
                </Button>
                <Withdraw noticeId={notice.id} title={notice.title} />
              </>
            )}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

function Withdraw({ noticeId, title }: { noticeId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await withdrawNotice({ noticeId, reason });
      if (result.ok) {
        toast.success("Withdrawn. It stays on the record, and so do the read receipts.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Ban className="size-3.5" aria-hidden="true" />
          Withdraw
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw &ldquo;{title}&rdquo;?</DialogTitle>
          <DialogDescription>
            It comes off the board for everybody. The record of who had already read it stays —
            that is exactly the question somebody asks afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="withdraw-reason">Why</Label>
          <Textarea
            id="withdraw-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="The date was wrong; superseded by a later circular; …"
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Keep it up</Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={pending || reason.trim().length < 4}
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Withdraw
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewNotice({ sections, roles }: { sections: Section[]; roles: Role[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<NoticeCategory>("general");
  const [audienceKind, setAudienceKind] = useState<"all" | "role" | "section">("all");
  const [role, setRole] = useState(roles[0]?.code ?? "teacher");
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? "");
  const [who, setWho] = useState<"students" | "parents" | "both">("both");
  const [isPinned, setIsPinned] = useState(false);
  const [expiresOn, setExpiresOn] = useState("");

  function save() {
    startTransition(async () => {
      const audience =
        audienceKind === "all"
          ? { kind: "all" as const }
          : audienceKind === "role"
            ? { kind: "role" as const, role }
            : { kind: "section" as const, sectionId, who };

      const result = await saveNotice({
        title,
        body,
        category,
        audience,
        isPinned,
        expiresOn: expiresOn || null,
      });

      if (result.ok) {
        toast.success("Saved as a draft. Nothing has been sent — publish it when you are ready.");
        setOpen(false);
        setTitle("");
        setBody("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden="true" />
          Write a notice
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Write a notice</DialogTitle>
          <DialogDescription>
            It is saved as a draft. Publishing puts it on the board and announces it once.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-title">Title</Label>
            <Input id="notice-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-body">Notice</Label>
            <Textarea
              id="notice-body"
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-category">Kind</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as NoticeCategory)}>
              <SelectTrigger id="notice-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTICE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {categoryLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-audience">Who it is for</Label>
            <Select
              value={audienceKind}
              onValueChange={(v) => setAudienceKind(v as typeof audienceKind)}
            >
              <SelectTrigger id="notice-audience">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everybody</SelectItem>
                <SelectItem value="role">One role</SelectItem>
                <SelectItem value="section">One class</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              This decides who can see it at all, not just who is told — the audience is checked in
              the database, not on the page.
            </p>
          </div>

          {audienceKind === "role" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notice-role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="notice-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {audienceKind === "section" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="notice-section">Class</Label>
                <Select value={sectionId} onValueChange={setSectionId}>
                  <SelectTrigger id="notice-section">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="notice-who">Students, parents or both</Label>
                <Select value={who} onValueChange={(v) => setWho(v as typeof who)}>
                  <SelectTrigger id="notice-who">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Both</SelectItem>
                    <SelectItem value="students">Students</SelectItem>
                    <SelectItem value="parents">Parents</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notice-expires">Comes off the board on</Label>
            <Input
              id="notice-expires"
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Leave it empty and it stays up.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="notice-pinned"
              checked={isPinned}
              onCheckedChange={(v) => setIsPinned(v === true)}
            />
            <Label htmlFor="notice-pinned" className="font-normal">
              Pin it to the top
            </Label>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Save as a draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
