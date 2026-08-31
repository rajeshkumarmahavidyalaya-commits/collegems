"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { SelectField, TextField } from "@/components/forms/form-fields";
import { ErrorSummary } from "@/components/forms/error-summary";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes-guard";
import { bookSchema, type BookInput } from "@/lib/validations/library";
import { createBook, updateBook } from "../actions";

export function BookForm({
  categories,
  book,
}: {
  categories: { id: string; name: string }[];
  book?: BookInput & { id: string };
}) {
  const router = useRouter();
  const isEdit = !!book;

  const form = useForm<BookInput>({
    resolver: zodResolver(bookSchema),
    defaultValues: book ?? {
      title: "",
      author: "",
      categoryId: null,
      isbn: "",
      publisher: "",
      edition: "",
      shelfLocation: "",
      totalCopies: 1,
    },
  });

  useUnsavedChangesGuard(form.formState.isDirty && !form.formState.isSubmitSuccessful);

  async function onSubmit(values: BookInput) {
    const result = isEdit ? await updateBook(book.id, values) : await createBook(values);

    if (!result.ok) {
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof BookInput, { message: messages[0] });
        }
      }
      toast.error(result.error);
      return;
    }

    toast.success(isEdit ? "Book updated" : "Book added to the catalog");
    router.push(`/library/books/${result.data.id}`);
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
        <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

        <Card>
          <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="title"
              label="Title"
              required
              className="sm:col-span-2"
            />
            <TextField control={form.control} name="author" label="Author" required />
            <SelectField
              control={form.control}
              name="categoryId"
              label="Category"
              placeholder="Uncategorised"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <TextField control={form.control} name="isbn" label="ISBN" />
            <TextField control={form.control} name="publisher" label="Publisher" />
            <TextField control={form.control} name="edition" label="Edition" />
            <TextField
              control={form.control}
              name="shelfLocation"
              label="Shelf location"
              description="Where the book physically sits, e.g. SCI-04"
            />
            <TextField
              control={form.control}
              name="totalCopies"
              label="Total copies"
              type="number"
              required
              description={
                isEdit
                  ? "Changing this adjusts available copies by the same amount."
                  : "All copies start as available."
              }
            />
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {isEdit ? "Save changes" : "Add book"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (
                !form.formState.isDirty ||
                window.confirm("Discard your unsaved changes?")
              ) {
                router.back();
              }
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}
