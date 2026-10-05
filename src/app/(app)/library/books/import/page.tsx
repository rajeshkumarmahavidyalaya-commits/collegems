import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { listCategories } from "../../actions";
import { BookImportView } from "./book-import-view";

export const metadata = { title: "Add books in bulk" };

/**
 * The reference's "Add New Books In Bulk". `hasPermission` decides what is
 * drawn; the `books` policy, through `library_import_books`, is the gate.
 */
export default async function BookImportPage() {
  const canManage = await hasPermission("library.manage");
  const categories = canManage ? await listCategories() : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Add New Books In Bulk</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Load a spreadsheet of books instead of typing each one in. Nothing is added until you
            have seen every row, fixed what is wrong and pressed <strong>Add</strong>.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/library/books">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Books
          </Link>
        </Button>
      </div>

      {canManage ? (
        <BookImportView subjects={categories.map((c) => c.name)} />
      ) : (
        <p className="max-w-2xl text-sm text-muted-foreground">
          Adding books needs <code className="font-mono">library.manage</code>, which your role does
          not hold.
        </p>
      )}
    </div>
  );
}
