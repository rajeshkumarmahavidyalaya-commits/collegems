import Link from "next/link";
import { BookPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listCategories } from "../actions";
import { BooksTable } from "./books-table";
import { CategoriesDialog } from "@/components/forms/categories-dialog";
import { deleteBookCategory, saveBookCategory } from "../actions";

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
          <h1 className="text-2xl font-semibold">Books</h1>
          <p className="text-sm text-muted-foreground">
            Every title held by {ctx?.tenantName ?? "the school"} library.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/library/issues">View Books Issued</Link>
          </Button>
          {canManage && (
            <>
              <CategoriesDialog
                title="Book categories"
                description="Deleting a category leaves its books in the catalogue, uncategorised."
                categories={categories}
                save={saveBookCategory}
                remove={deleteBookCategory}
                deleteNote="Its books stay, uncategorised."
              />
              <Button asChild>
                <Link href="/library/books/new">
                  <BookPlus className="size-4" aria-hidden="true" />
                  Add New Book
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      <BooksTable categories={categories} canManage={canManage} />
    </div>
  );
}
