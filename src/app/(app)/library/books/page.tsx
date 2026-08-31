import Link from "next/link";
import { BookPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listCategories } from "../actions";
import { BooksTable } from "./books-table";

export const metadata = { title: "Catalog" };

export default async function BooksPage() {
  const [ctx, categories, canManage] = await Promise.all([
    getUserContext(),
    listCategories(),
    hasPermission("library.manage"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Catalog</h1>
          <p className="text-sm text-muted-foreground">
            Every title held by {ctx?.tenantName ?? "the school"} library.
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/library/books/new">
              <BookPlus className="size-4" aria-hidden="true" />
              Add book
            </Link>
          </Button>
        )}
      </div>

      <BooksTable categories={categories} canManage={canManage} />
    </div>
  );
}
