import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../../students/actions";
import { listEventTypes, listRecipients, listRoles } from "../actions";
import { ComposeForm } from "./compose-form";

export const metadata = { title: "Compose a notification" };

export default async function ComposePage() {
  const canSend = await hasPermission("communication.send");
  if (!canSend) redirect("/notifications");

  const [eventTypes, roles, sections, recipients] = await Promise.all([
    listEventTypes(),
    listRoles(),
    listSections(),
    listRecipients(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Compose a notification</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          One message, fanned out to everyone the audience resolves to, on every channel you
          choose. Nothing here calls a provider directly — the message is recorded, and delivery
          is a separate concern with its own log.
        </p>
      </div>

      <ComposeForm
        eventTypes={eventTypes}
        roles={roles}
        sections={sections}
        recipients={recipients}
      />
    </div>
  );
}
