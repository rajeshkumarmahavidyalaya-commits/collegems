import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import { listCategories } from "../../actions";
import { BookForm } from "../book-form";

export const metadata = { title: "Add book" };

export default async function NewBookPage() {
  const canManage = await hasPermission("library.manage");
  if (!canManage) redirect("/library/books");

  const categories = await listCategories();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Add a book</h1>
        <p className="text-sm text-muted-foreground">
          New titles become available to issue as soon as they&apos;re saved.
        </p>
      </div>
      <BookForm categories={categories} />
    </div>
  );
}
