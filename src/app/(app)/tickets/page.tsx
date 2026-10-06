import { Ticket } from "lucide-react";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { listMyChildren } from "@/lib/auth/family";
import { listTickets, ticketOptions } from "./actions";
import { FamilyTickets } from "./family-tickets";
import { TicketsView } from "./tickets-view";

export const metadata = { title: "Tickets" };

/**
 * The reference's SM Tickets (0348). One address, two screens, chosen by the
 * tier (rule 4: a tier decides what is shown, never what may be done): the
 * office's Tickets Management, or a family's Support Tickets. What each may
 * read and write is the policies and the two functions.
 */
export default async function TicketsPage() {
  const ctx = await getUserContext();
  const [rows, options] = await Promise.all([listTickets(), ticketOptions()]);
  if (ctx?.roleTier === "student") {
    const children = await listMyChildren();
    return (
      <div className="flex flex-col gap-4">
        <PageToolbar title="Support Tickets" icon={Ticket} />
        <FamilyTickets
          rows={rows}
          childList={children.map((c) => ({ id: c.studentId, name: c.name }))}
          subjects={options.subjects}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Tickets Management" icon={Ticket} />
      <TicketsView rows={rows} options={options} isAdmin={ctx?.roleCode === "admin"} />
    </div>
  );
}
