import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** Comments stripped, so the guard reads the SQL and not the prose about it. */
function sql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * The **latest** definition of a function, because migrations are immutable and
 * `create or replace` is how one changes: "what does this function do" is
 * always a question about the highest-numbered file that defines it. Anchored
 * on `create ... function`, never on the name alone — `lastIndexOf(name)` finds
 * the `comment on function` that follows the body, and a guard reading an empty
 * slice passes on nothing.
 */
function functionBody(name: string): string {
  let found = "";
  for (const file of migrationFiles()) {
    const body = sql(readFileSync(join(MIGRATIONS, file), "utf8"));
    const pattern = new RegExp(
      `create (?:or replace )?function public\\.${name}\\s*\\(`,
      "g",
    );
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const rest = body.slice(match.index);
      const end = rest.indexOf("\n$$;");
      found = end === -1 ? rest : rest.slice(0, end);
    }
  }
  return found;
}

/**
 * A sale is two writes. So is undoing one.
 *
 * `stock_sell_to_student` takes goods off the shelf **and** puts the amount on
 * a family's fee account, in one transaction. Every function that can reach
 * either half alone therefore has to refuse a sale by name and send it to the
 * one function that does both.
 *
 * `0263` wrote that rule down and applied it to two of the three doors —
 * `fees_reverse_entry` (the money side) and `stock_record_movement` (writing a
 * sale as an ordinary movement). It left `stock_reverse_movement`, which is the
 * one the item screen already drew a button for, on every row. Probed as an
 * administrator in a rolled-back transaction, on the live college:
 *
 * ```
 * stock  15.00 -> 13.00 (sold 2) -> 15.00  after stock_reverse_movement
 * owed    8.00 -> 58.00 (charged) -> 58.00  after stock_reverse_movement
 * ```
 *
 * The goods come back and the family stays charged. Fixed in `0265`, and this
 * is the executable half — because the defect was not a missing idea, it was an
 * idea written into one function and not the others.
 *
 * > **A rule written into one function is not a rule.** Rule 12 already asks
 * > *who else does this?* about a fix. A refusal has the sibling question:
 * > **what else reaches this row?**
 *
 * The guard runs without a database, which is what makes it run in CI here.
 *
 * Each door below carries **what it sends the caller to** — not the same
 * function for all three, and the first draft of this guard got that wrong.
 * `stock_record_movement` refuses an attempt to *create* a sale, so it names
 * the seller; the other two refuse an attempt to *undo* half of one, so they
 * name the un-seller. A guard demanding one target for all three would have had
 * a correct message rewritten to satisfy it.
 */
const DOORS_THAT_MUST_REFUSE_A_SALE: { name: string; sendsTo: string }[] = [
  { name: "fees_reverse_entry", sendsTo: "stock_sale_reverse" },
  { name: "stock_record_movement", sendsTo: "stock_sell_to_student" },
  // This one names the action rather than the function: its message is shown
  // to a store keeper on a screen, not to somebody reading SQL.
  { name: "stock_reverse_movement", sendsTo: "Undo sale" },
];

/**
 * How a body says *this row is a sale* — and there are two spellings, because
 * the three doors sit at different distances from the row.
 *
 * Two of them hold the movement, so they compare its `kind`. `fees_reverse_entry`
 * holds a **ledger** row, and asks whether it carries a `stock_movement_id` —
 * which is **stricter** than `entry_type = 'sale'`, since it catches any charge
 * tied to stock whatever its type. The first draft of this guard demanded the
 * narrower spelling and reported that correct function as a defect.
 *
 * > *A guard that reports a correct file is a guard somebody switches off.*
 * > Read which of the two you have — a weak check or a faulty plant — before
 * > you change anything.
 */
function detectsASale(body: string): boolean {
  return (
    /(p_kind|v_m\.kind|kind)\s*=\s*'sale'/.test(body) ||
    /stock_movement_id is not null/.test(body)
  );
}

describe("a correction to a sale is two writes, or it is not a correction", () => {
  it.each(DOORS_THAT_MUST_REFUSE_A_SALE)("$name refuses a sale", ({ name }) => {
    const body = functionBody(name);
    // A guard reading an empty slice passes on nothing, so say so first.
    expect(body, `no definition of public.${name} found in the migrations`).not.toBe("");

    // Anchored on the comparison rather than on the word: `'sale'` appears in
    // a dozen places in these bodies (the entry type, the movement kind, a
    // format string), and asserting that a string appears *somewhere* guards
    // the string and not the mechanism.
    expect(detectsASale(body), `${name} does not detect a sale`).toBe(true);
    expect(body, `${name} detects a sale and does not raise`).toContain("raise exception");
  });

  it.each(DOORS_THAT_MUST_REFUSE_A_SALE)(
    "$name sends the caller to $sendsTo",
    ({ name, sendsTo }) => {
      // A refusal that does not say where to go leaves somebody stuck at a
      // counter with a child in front of them.
      expect(functionBody(name)).toContain(sendsTo);
    },
  );

  it("the one function that may write a sale is the one that writes both rows", () => {
    const body = functionBody("stock_sell_to_student");
    expect(body).toContain("insert into public.stock_movements");
    expect(body).toContain("insert into public.ledger_entries");

    // And undoing it writes both too: a `return` movement and a reversing
    // ledger entry. One without the other is the defect this file exists for.
    const undo = functionBody("stock_sale_reverse");
    expect(undo).toContain("insert into public.stock_movements");
    expect(undo).toContain("insert into public.ledger_entries");
    expect(undo).toContain("reverses_entry_id");
  });

  it("the screen sends a sale to the sale undo, and never to the movement one", () => {
    const ledger = readFileSync(
      join(ROOT, "src", "app", "(app)", "inventory", "[itemId]", "item-ledger.tsx"),
      "utf8",
    );
    // Both actions are imported, which is the point: the component chooses.
    expect(ledger).toContain("reverseSale");
    expect(ledger).toContain("reverseMovement");

    // The choice is made on the kind, in one place. Verified by planting
    // `const isSale = false;`, which fails this.
    expect(ledger).toMatch(/const isSale = row\?\.kind === "sale"/);
    expect(ledger).toMatch(/isSale\s*\n?\s*\?\s*await reverseSale/);
  });
});

/**
 * And the read side of the same omission: `0261` added three columns and no
 * reader was taught to show any of them, so the item history said a sale of two
 * exercise books happened and could not say to whom.
 */
describe("a sale names its buyer", () => {
  it("stock_ledger resolves the student behind sold_to_student_id", () => {
    const body = functionBody("stock_ledger");
    expect(body).toContain("sold_to_student_id");
    expect(body).toContain("unit_price");
  });

  it("a name is built with coalesce, not with ||, so no surname is not no name", () => {
    // `a || ' ' || b` is null when either side is — true of people on this
    // college's roll, and the reason a staff issue could already show a blank
    // where a name belongs.
    const body = functionBody("stock_ledger");
    expect(body).not.toMatch(/first_name\s*\|\|\s*' '\s*\|\|\s*\w+\.last_name/);
    expect(body).toContain("coalesce(buyer.last_name, '')");
  });

  it("stock_on_hand carries the price, so a screen can tell not-for-sale from free", () => {
    expect(functionBody("stock_on_hand")).toContain("i.sale_price");
  });
});
