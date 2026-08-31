import { z } from "zod";

export const bookSchema = z.object({
  title: z.string().min(1, "Title is required").max(300),
  author: z.string().min(1, "Author is required").max(200),
  categoryId: z.string().uuid().nullable().optional(),
  isbn: z.string().max(32).nullable().optional(),
  publisher: z.string().max(200).nullable().optional(),
  edition: z.string().max(50).nullable().optional(),
  shelfLocation: z.string().max(100).nullable().optional(),
  totalCopies: z.number().int().min(1, "Must have at least 1 copy").max(1000),
});

export type BookInput = z.infer<typeof bookSchema>;

export const memberSchema = z.object({
  holderType: z.enum(["student", "staff"]),
  holderId: z.string().uuid("Choose a student or staff member"),
  membershipNumber: z.string().min(1, "Membership number is required").max(50),
  maxBooks: z.number().int().min(1).max(20),
});

export type MemberInput = z.infer<typeof memberSchema>;

export const issueBookSchema = z.object({
  bookId: z.string().uuid("Choose a book"),
  memberId: z.string().uuid("Choose a member"),
  dueAt: z.string().min(1, "Due date is required"),
});

export type IssueBookInput = z.infer<typeof issueBookSchema>;
