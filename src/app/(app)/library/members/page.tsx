import { MembersTable } from "./members-table";

export const metadata = { title: "Library members" };

export default function MembersPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Library members</h1>
        <p className="text-sm text-muted-foreground">
          Students and staff who can borrow, and how many books each has out.
        </p>
      </div>
      <MembersTable />
    </div>
  );
}
