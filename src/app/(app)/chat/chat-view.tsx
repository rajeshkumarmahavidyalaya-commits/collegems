"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, MessagesSquare, Plus, Search, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/utils";
import {
  messageTeacher,
  sendMessage,
  startChat,
  studentsInClass,
  type ChatMember,
  type ChatMessage,
  type ConversationRow,
  type ReachableStudent,
  type TeacherOption,
} from "./actions";

/** How often an open page asks for new messages: often enough to read as a conversation. */
const REFRESH_MS = 10_000;

export function ChatView({
  conversations,
  selectedId,
  thread,
  mode,
  sections,
  teachers,
}: {
  conversations: ConversationRow[];
  selectedId: string | null;
  thread: { members: ChatMember[]; messages: ChatMessage[] } | null;
  mode: "staff" | "family" | "none";
  sections: { id: string; label: string }[];
  teachers: TeacherOption[];
}) {
  const { formatDateTime } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false);

  // New messages arrive by asking again, only while the page is in front.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [router]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? conversations.filter((c) => `${c.title} ${c.lastMessage ?? ""}`.toLowerCase().includes(q)) : conversations;
  }, [conversations, query]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="grid min-h-[60svh] gap-4 md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
      <section
        aria-labelledby="chat-list"
        className={cn("flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3", selected && "hidden md:flex")}
      >
        <div className="flex items-center gap-2">
          <h2 id="chat-list" className="text-base font-semibold">
            Conversations
          </h2>
          {mode !== "none" && (
            <Button size="sm" className="ms-auto" onClick={() => setStarting(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New Chat
            </Button>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Label htmlFor="chat-search" className="sr-only">
            Search conversations
          </Label>
          <Input id="chat-search" className="ps-8" placeholder="Search conversations…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessagesSquare className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">No conversations yet</p>
            <p className="text-sm text-muted-foreground">
              {mode === "staff"
                ? "Start one with a student you teach, or a group from a class."
                : mode === "family"
                  ? "Message one of your child's teachers."
                  : "A teacher or the office can start a conversation with you."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1 overflow-y-auto">
            {shown.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/chat?c=${c.id}`}
                  aria-current={c.id === selectedId ? "page" : undefined}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm hover:bg-accent",
                    c.id === selectedId && "bg-accent",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {c.kind === "group" && <Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span className="truncate font-medium">{c.title}</span>
                    {c.unread > 0 && (
                      <Badge className="ms-auto" aria-label={`${c.unread} unread`}>
                        {c.unread}
                      </Badge>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{c.lastMessage ?? "No messages yet"}</span>
                </Link>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No conversation matches.</li>}
          </ul>
        )}
      </section>

      <section aria-label="Conversation" className={cn("flex min-w-0 flex-col rounded-lg border bg-card", !selected && "hidden md:flex")}>
        {selected && thread ? (
          <Thread key={selected.id} conversation={selected} thread={thread} formatDateTime={formatDateTime} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <MessagesSquare className="size-6" aria-hidden="true" />
            Choose a conversation.
          </div>
        )}
      </section>

      {starting && mode === "staff" && <StartDialog sections={sections} onClose={() => setStarting(false)} />}
      {starting && mode === "family" && <TeacherDialog teachers={teachers} onClose={() => setStarting(false)} />}
    </div>
  );
}

function Thread({
  conversation,
  thread,
  formatDateTime,
}: {
  conversation: ConversationRow;
  thread: { members: ChatMember[]; messages: ChatMessage[] };
  formatDateTime: (v: string) => string;
}) {
  const [text, setText] = useState("");
  const [, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const nameOf = new Map(thread.members.map((m) => [m.userId, m]));
  const others = thread.members.filter((m) => !m.isMe);
  const me = thread.members.find((m) => m.isMe)?.userId ?? "";
  // A sent message is drawn at once, marked as sending, and replaced by the
  // saved one when the page comes back; if the save fails it simply goes.
  const [messages, addSending] = useOptimistic(thread.messages, (list: ChatMessage[], m: ChatMessage) => [...list, m]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    start(async () => {
      addSending({ id: `sending-${Date.now()}`, senderId: me, body, createdAt: "" });
      // The action's revalidatePath sends the page back with the message in
      // it; a router.refresh here would render the page a second time.
      const r = await sendMessage(conversation.id, body);
      if (!r.ok) {
        setText(body);
        toast.error(r.error);
      }
    });
  }

  return (
    <>
      <header className="flex items-center gap-2 border-b p-3">
        <Button asChild size="icon" variant="ghost" className="md:hidden" aria-label="All conversations">
          <Link href="/chat">
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{conversation.title}</h2>
          {conversation.kind === "group" && (
            <p className="truncate text-xs text-muted-foreground">{others.map((m) => m.name).join(", ")}</p>
          )}
        </div>
      </header>
      <ol className="flex max-h-[55svh] flex-1 flex-col gap-2 overflow-y-auto p-3" aria-live="polite">
        {messages.length === 0 && <li className="py-10 text-center text-sm text-muted-foreground">No messages yet. Say hello.</li>}
        {messages.map((m) => {
          const who = nameOf.get(m.senderId);
          const mine = who?.isMe ?? false;
          return (
            <li key={m.id} className={cn("flex max-w-[85%] flex-col gap-0.5", mine ? "self-end items-end" : "self-start")}>
              {!mine && conversation.kind === "group" && <span className="text-xs font-medium text-muted-foreground">{who?.name ?? "—"}</span>}
              <p className={cn("whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {m.body}
              </p>
              {m.createdAt ? (
                <time dateTime={m.createdAt} className="text-[11px] text-muted-foreground">
                  {formatDateTime(m.createdAt)}
                </time>
              ) : (
                <span className="text-[11px] text-muted-foreground">Sending…</span>
              )}
            </li>
          );
        })}
        <div ref={end} />
      </ol>
      <form onSubmit={send} className="flex items-end gap-2 border-t p-3">
        <Label htmlFor="chat-message" className="sr-only">
          Message
        </Label>
        <Textarea
          id="chat-message"
          rows={2}
          maxLength={4000}
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button type="submit" disabled={!text.trim()}>
          <Send className="size-4" aria-hidden="true" />
          Send
        </Button>
      </form>
    </>
  );
}

/** Staff: a class, then the students in it you may reach; one is a direct chat, several a named group. */
function StartDialog({ sections, onClose }: { sections: { id: string; label: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [sectionId, setSectionId] = useState("");
  const [students, setStudents] = useState<ReachableStudent[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function pickClass(id: string) {
    setSectionId(id);
    setChosen([]);
    setStudents(null);
    start(async () => {
      const r = await studentsInClass(id);
      if (!r.ok) return setError(r.error);
      setStudents(r.data);
    });
  }

  function submit() {
    setError(null);
    if (chosen.length === 0) return setError("Choose at least one student.");
    if (chosen.length > 1 && !name.trim()) return setError("Give a chat with several students a name.");
    start(async () => {
      const r = await startChat(chosen.length > 1 ? name : "", chosen);
      if (!r.ok) return setError(r.error);
      const skipped = r.data.withoutLogin;
      toast.success(
        r.data.existing
          ? "That conversation already exists; it is open."
          : `Chat started with ${r.data.added} ${r.data.added === 1 ? "student" : "students"}.` +
              (skipped ? ` ${skipped} ${skipped === 1 ? "has" : "have"} no login yet and ${skipped === 1 ? "was" : "were"} not added.` : ""),
      );
      onClose();
      router.push(`/chat?c=${r.data.conversationId}`);
    });
  }

  const withLogin = (students ?? []).filter((s) => s.hasLogin);
  const all = withLogin.length > 0 && chosen.length === withLogin.length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start Chat</DialogTitle>
          <DialogDescription>Choose a class, then one student for a direct chat, or several for a named group.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chat-class">Class</Label>
            <Select value={sectionId} onValueChange={pickClass}>
              <SelectTrigger id="chat-class" className="w-full">
                <SelectValue placeholder="Choose a class" />
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
          {students && (
            <fieldset className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <legend className="text-sm font-medium">Students</legend>
                {withLogin.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setChosen(all ? [] : withLogin.map((s) => s.id))}>
                    {all ? "Clear all" : "Select all"}
                  </Button>
                )}
              </div>
              {students.length === 0 ? (
                <p className="text-sm text-muted-foreground">You do not teach anybody in this class this year.</p>
              ) : (
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-2">
                  {students.map((s) => (
                    <label key={s.id} className={cn("flex items-center gap-2 rounded px-2 py-1.5 text-sm", s.hasLogin ? "cursor-pointer hover:bg-accent" : "opacity-60")}>
                      <Checkbox
                        disabled={!s.hasLogin}
                        checked={chosen.includes(s.id)}
                        onCheckedChange={(on) => setChosen((c) => (on ? [...c, s.id] : c.filter((x) => x !== s.id)))}
                      />
                      <span className="min-w-0 flex-1 break-words">
                        {s.name} <span className="text-xs text-muted-foreground">{s.admissionNumber}</span>
                      </span>
                      {!s.hasLogin && <span className="text-xs text-muted-foreground">No login</span>}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          {chosen.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-name">Group Name</Label>
              <Input id="chat-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending || chosen.length === 0}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Start Chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A family: "Message a Teacher", from their child's teachers this year. */
function TeacherDialog({ teachers, onClose }: { teachers: TeacherOption[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open(t: TeacherOption) {
    setError(null);
    start(async () => {
      const r = await messageTeacher(t.staffId);
      if (!r.ok) return setError(r.error);
      onClose();
      router.push(`/chat?c=${r.data.conversationId}`);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Message a Teacher</DialogTitle>
          <DialogDescription>Your child&apos;s teachers this year.</DialogDescription>
        </DialogHeader>
        {teachers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No teachers are assigned to your child&apos;s class yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {teachers.map((t) => (
              <li key={t.staffId} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.what ?? ""}</p>
                </div>
                {t.hasLogin ? (
                  <Button size="sm" onClick={() => open(t)} disabled={pending}>
                    Message
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">No login yet</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
