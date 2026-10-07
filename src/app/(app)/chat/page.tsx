import { MessagesSquare } from "lucide-react";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { listSections } from "../students/actions";
import { listConversations, myTeachers, openConversation } from "./actions";
import { ChatView } from "./chat-view";

export const metadata = { title: "Chat" };

/**
 * The reference's SM Chat (0350). Staff start conversations with the students
 * they teach; a family messages their child's teachers. Who may talk to whom
 * is decided in Postgres; this page draws the form that fits the seat (the
 * tier, which decides only what is shown).
 */
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const ctx = await getUserContext();
  const isFamily = ctx?.roleTier === "student";
  const canStart = ctx?.roleCode === "admin" || ctx?.roleCode === "teacher";
  // Opening marks the conversation read, so it goes first: listed alongside
  // it, the conversation on screen would still carry its unread count.
  const open = c ? await openConversation(c) : null;
  const [conversations, sections, teachers] = await Promise.all([
    listConversations(),
    canStart ? listSections() : Promise.resolve([]),
    isFamily ? myTeachers() : Promise.resolve([]),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Chat" icon={MessagesSquare} />
      <ChatView
        conversations={conversations}
        selectedId={open ? (c ?? null) : null}
        thread={open}
        mode={isFamily ? "family" : canStart ? "staff" : "none"}
        sections={sections.map((s) => ({ id: s.id, label: s.label }))}
        teachers={teachers}
      />
    </div>
  );
}
