import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAssistantReply, suggestionsFor, tableToCsv } from "@/lib/validations/assistant";

/**
 * The assistant (migration 0283) has no access of its own: every tool reads
 * through a client carrying the asker's JWT, so RLS and the permission matrix
 * decide what each seat's assistant can answer. The service role exists in the
 * function for exactly one call -- the provider key from Vault. These checks
 * read the source, so they run where the database suites skip.
 */

const FN = readFileSync(join(process.cwd(), "supabase/functions/assistant/index.ts"), "utf8");
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/0283_an_assistant_that_reads_as_the_person_asking.sql"),
  "utf8",
);

/** Strip // and block comments, so prose neither hides nor fakes a violation. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the assistant reads as the person asking", () => {
  const body = code(FN);

  it("uses the service role for the provider key and nothing else", () => {
    const serviceCalls = [...body.matchAll(/\bservice\s*\.\s*(rpc|from|auth|storage|functions)\s*\(\s*"?([\w]*)/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    );
    expect(serviceCalls).toEqual(["rpc:assistant_provider_key"]);
    // And the service client is made exactly once.
    expect(body.match(/SUPABASE_SERVICE_ROLE_KEY/g)?.length).toBe(1);
  });

  it("builds the reading client from the caller's own Authorization header", () => {
    expect(body).toMatch(/createClient\(\s*url,\s*Deno\.env\.get\("SUPABASE_ANON_KEY"\)!,\s*\{\s*global:\s*\{\s*headers:\s*\{\s*Authorization:\s*authorization\s*\}/);
  });

  it("has no tool that writes", () => {
    // The one write is the log row, on the caller's client, under its own policy.
    const writes = [...body.matchAll(/\.(insert|update|upsert|delete)\s*\(/g)].map((m) => m[1]);
    expect(writes).toEqual(["insert"]);
    expect(body).toMatch(/db\.from\("assistant_messages"\)\.insert\(/);
    // Every rpc the tools call is a read path somebody already relies on.
    const rpcs = new Set([...body.matchAll(/\bdb\.rpc\(\s*"(\w+)"/g)].map((m) => m[1]));
    expect([...rpcs].sort()).toEqual(
      [
        "assistant_quota",
        "checks_run",
        "dashboard_summary",
        "global_search",
        "mobile_student",
        "report_list",
        "report_run",
        "subject_choices_for_student",
      ].sort(),
    );
  });

  it("keeps the provider key out of the Next.js app", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const src = readFileSync(p, "utf8");
          if (/GEMINI|generativelanguage|assistant_provider_key|AIza[\w-]{20,}|\bAQ\.[\w-]{20,}/.test(src)) hits.push(p);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    // database.types.ts does not list the key function: it is not callable by
    // anything the app holds.
    expect(hits).toEqual([]);
  });

  it("revokes the key reader from every role holding a JWT", () => {
    expect(MIGRATION).toMatch(
      /revoke all on function public\.assistant_provider_key\(\) from public, anon, authenticated;/,
    );
    expect(MIGRATION).toMatch(/grant execute on function public\.assistant_provider_key\(\) to service_role;/);
    expect(MIGRATION).toMatch(/revoke update, delete on public\.assistant_messages from authenticated, anon;/);
  });
});

describe("what the chat does with a reply", () => {
  it("shows declared columns only, and falls back to the row's keys", () => {
    const r = parseAssistantReply({
      answer: "x",
      remaining: 3,
      tables: [
        { title: "A", columns: [{ key: "name", label: "Name" }], rows: [{ name: "Riya", student_id: "u" }], total: 9 },
        { rows: [{ full_name: "B" }] },
      ],
    });
    expect(r.tables[0].columns).toEqual([{ key: "name", label: "Name" }]);
    expect(r.tables[0].total).toBe(9);
    expect(r.tables[1].columns).toEqual([{ key: "full_name", label: "full name" }]);
    expect(parseAssistantReply("nonsense")).toEqual({ answer: "", tables: [], remaining: null });
  });

  it("writes a CSV a spreadsheet opens safely", () => {
    const csv = tableToCsv({
      columns: [{ key: "a", label: "Amount" }, { key: "b", label: "Note" }],
      rows: [{ a: "₹1,200.00", b: '=HYPERLINK("x")' }],
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('"₹1,200.00"');
  });

  it("offers a parent questions about their child, not about themselves", () => {
    expect(suggestionsFor("student", "guardian").join(" ")).toMatch(/child/);
    expect(suggestionsFor("student", "student").join(" ")).not.toMatch(/child/);
    expect(suggestionsFor("principal")).not.toEqual(suggestionsFor("staff"));
  });
});
