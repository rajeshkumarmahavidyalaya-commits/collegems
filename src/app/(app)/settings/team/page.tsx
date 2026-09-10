import { hasPermission } from "@/lib/auth/permissions";
import { listInvitations, listRoles } from "./actions";
import { TeamView } from "./team-view";

export const metadata = { title: "People and invitations" };

export default async function TeamPage() {
  // `users.manage` decides whether the *Invite* form is drawn — the same
  // permission that draws /settings/permissions, because both screens answer
  // "who may sign in to this college and as what". It used to read
  // `settings.manage`, which also meant the school's address and its fee heads.
  //
  // It is not the gate: `invitations` carries an admin-only policy, so a
  // non-admin who calls the action directly writes nothing. Rule 4 — the UI
  // layer is never the gate.
  const [invitations, roles, canManage] = await Promise.all([
    listInvitations(),
    listRoles(),
    hasPermission("users.manage"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">People and invitations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who can sign in to this school, and who has been asked to.
        </p>
      </div>

      <TeamView invitations={invitations} roles={roles} canManage={canManage} />
    </div>
  );
}
