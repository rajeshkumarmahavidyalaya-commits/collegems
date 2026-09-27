import { hasPermission } from "@/lib/auth/permissions";
import { MembersTable } from "./members-table";

export const metadata = { title: "Library members" };

export default async function MembersPage() {
  const canManage = await hasPermission("library.manage");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Library members</h1>
        <p className="text-sm text-muted-foreground">
          Students and staff who can borrow, and how many books each has out.
        </p>
      </div>
      <MembersTable canManage={canManage} />
    </div>
  );
}
