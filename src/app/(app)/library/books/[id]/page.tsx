import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IssueBookDialog } from "../../issue-book-dialog";

export const metadata = { title: "Book" };

export default async function BookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const canManage = await hasPermission("library.manage");

  const { data: book } = await supabase
    .from("books")
    .select(
      "id, title, author, isbn, publisher, edition, shelf_location, total_copies, available_copies, created_at, book_categories ( name )",
    )
    .eq("id", id)
    .maybeSingle();

  if (!book) notFound();

  const { data: issues } = await supabase
    .from("book_issues")
    .select(
      `id, status, issued_at, due_at, returned_at, fine_amount,
       members ( membership_number,
                 students ( people:person_id ( first_name, last_name ) ),
                 staff ( people:person_id ( first_name, last_name ) ) )`,
    )
    .eq("book_id", id)
    .order("issued_at", { ascending: false })
    .limit(20);

  const today = new Date().toISOString().slice(0, 10);

  const facts = [
    { label: "Author", value: book.author },
    { label: "Category", value: book.book_categories?.name ?? "—" },
    { label: "ISBN", value: book.isbn ?? "—", mono: true },
    { label: "Publisher", value: book.publisher ?? "—" },
    { label: "Edition", value: book.edition ?? "—" },
    { label: "Shelf", value: book.shelf_location ?? "—", mono: true },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-balance">{book.title}</h1>
          <p className="text-sm text-muted-foreground">{book.author}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && book.available_copies > 0 && (
            <IssueBookDialog bookId={book.id} bookTitle={book.title} />
          )}
          {canManage && (
            <Button asChild variant="outline">
              <Link href={`/library/books/${book.id}/edit`}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {fact.label}
                  </dt>
                  <dd className={fact.mono ? "font-mono text-sm break-words" : "text-sm break-words"}>
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Availability</CardTitle>
            <CardDescription>Copies on the shelf right now</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-3xl font-semibold tabular-nums">
              {book.available_copies}
              <span className="text-lg text-muted-foreground">/{book.total_copies}</span>
            </p>
            {book.available_copies === 0 && (
              <Badge variant="warning" className="mt-3">
                Every copy is out
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Issue history</CardTitle>
          <CardDescription>The 20 most recent issues of this title</CardDescription>
        </CardHeader>
        <CardContent>
          {!issues || issues.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              This book has never been issued.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Fine</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.map((issue) => {
                  const person = issue.members?.students?.people ?? issue.members?.staff?.people;
                  const overdue = issue.status === "issued" && issue.due_at < today;
                  return (
                    <TableRow key={issue.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{person ? `${person.first_name} ${person.last_name}` : "—"}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {issue.members?.membership_number}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {format(new Date(issue.issued_at), "d MMM yyyy")}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {format(new Date(issue.due_at), "d MMM yyyy")}
                      </TableCell>
                      <TableCell>
                        {issue.status === "returned" ? (
                          <Badge variant="secondary">Returned</Badge>
                        ) : overdue ? (
                          <Badge variant="destructive">Overdue</Badge>
                        ) : (
                          <Badge variant="outline">Issued</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {Number(issue.fine_amount) > 0 ? `₹${Number(issue.fine_amount).toFixed(2)}` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
