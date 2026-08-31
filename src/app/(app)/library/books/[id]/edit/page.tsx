import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/permissions";
import { listCategories } from "../../../actions";
import { BookForm } from "../../book-form";

export const metadata = { title: "Edit book" };

export default async function EditBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canManage = await hasPermission("library.manage");
  if (!canManage) redirect(`/library/books/${id}`);

  const supabase = await createClient();
  const [{ data: book }, categories] = await Promise.all([
    supabase
      .from("books")
      .select("id, title, author, category_id, isbn, publisher, edition, shelf_location, total_copies")
      .eq("id", id)
      .maybeSingle(),
    listCategories(),
  ]);

  if (!book) notFound();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Edit book</h1>
        <p className="text-sm text-muted-foreground text-balance">{book.title}</p>
      </div>
      <BookForm
        categories={categories}
        book={{
          id: book.id,
          title: book.title,
          author: book.author,
          categoryId: book.category_id,
          isbn: book.isbn,
          publisher: book.publisher,
          edition: book.edition,
          shelfLocation: book.shelf_location,
          totalCopies: book.total_copies,
        }}
      />
    </div>
  );
}
