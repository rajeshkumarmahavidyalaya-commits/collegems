import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Integration coverage for the library module's business rules. These run
 * against the real database through the real RLS policies, because the rules
 * they check (availability accounting, borrowing caps, tenant scoping of the
 * RPCs) live in Postgres, not in the TypeScript layer.
 */
describe("library issue/return flow", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let bookId: string;
  let memberId: string;
  const createdIssueIds: string[] = [];

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: book } = await a
      .from("books")
      .select("id")
      .gt("available_copies", 0)
      .limit(1)
      .single();
    bookId = book!.id;

    const { data: member } = await a
      .from("members")
      .select("id")
      .eq("status", "active")
      .limit(1)
      .single();
    memberId = member!.id;
  });

  afterAll(async () => {
    // Return anything this suite issued so the demo data stays consistent.
    for (const id of createdIssueIds) {
      await a.rpc("library_return_book", { p_issue_id: id });
    }
  });

  it("issuing a book decrements available copies and records the issue", async () => {
    const { data: before } = await a
      .from("books")
      .select("available_copies")
      .eq("id", bookId)
      .single();

    const { data: issue, error } = await a.rpc("library_issue_book", {
      p_book_id: bookId,
      p_member_id: memberId,
    });

    expect(error).toBeNull();
    expect(issue).toBeTruthy();
    createdIssueIds.push(issue!.id);

    expect(issue!.status).toBe("issued");
    expect(issue!.session_id).toBeTruthy(); // session-scoped per rule 2

    const { data: after } = await a
      .from("books")
      .select("available_copies")
      .eq("id", bookId)
      .single();

    expect(after!.available_copies).toBe(before!.available_copies - 1);
  });

  it("returning a book restores the copy and closes the issue", async () => {
    const issueId = createdIssueIds.pop()!;

    const { data: before } = await a
      .from("books")
      .select("available_copies")
      .eq("id", bookId)
      .single();

    const { data: returned, error } = await a.rpc("library_return_book", {
      p_issue_id: issueId,
    });

    expect(error).toBeNull();
    expect(returned!.status).toBe("returned");
    expect(returned!.returned_at).toBeTruthy();

    const { data: after } = await a
      .from("books")
      .select("available_copies")
      .eq("id", bookId)
      .single();

    expect(after!.available_copies).toBe(before!.available_copies + 1);
  });

  it("a book cannot be returned twice", async () => {
    const { data: issue } = await a.rpc("library_issue_book", {
      p_book_id: bookId,
      p_member_id: memberId,
    });

    await a.rpc("library_return_book", { p_issue_id: issue!.id });
    const { error } = await a.rpc("library_return_book", { p_issue_id: issue!.id });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already returned/i);
  });

  it("enforces the member's borrowing limit", async () => {
    const { data: member } = await a
      .from("members")
      .select("id, max_books")
      .eq("id", memberId)
      .single();

    const { data: books } = await a
      .from("books")
      .select("id")
      .gt("available_copies", 0)
      .limit(member!.max_books + 1);

    const issued: string[] = [];
    let limitError: string | null = null;

    for (const book of books ?? []) {
      const { data, error } = await a.rpc("library_issue_book", {
        p_book_id: book.id,
        p_member_id: member!.id,
      });
      if (error) {
        limitError = error.message;
        break;
      }
      issued.push(data!.id);
    }

    for (const id of issued) {
      await a.rpc("library_return_book", { p_issue_id: id });
    }

    expect(limitError).toMatch(/borrowing limit/i);
  });

  it("a librarian in tenant B cannot issue a tenant A book", async () => {
    const { error } = await b.rpc("library_issue_book", {
      p_book_id: bookId,
      p_member_id: memberId,
    });

    // Tenant A's book is invisible to tenant B, so the RPC can't find it.
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/book not found/i);
  });
});
