/**
 * Class tests (0304): the one rule for turning an edited sheet into writes,
 * and the parse of what a person typed. No imports, so the sheet, the server
 * action and a test all read the same definition.
 */

export type TestMarkInput = { studentId: string; marks: number | null; absent: boolean };

/**
 * A cell as typed: blank, a number, or "AB" for absent -- the exam marks
 * grid's convention, so a teacher types the same thing in both.
 */
export function parseCell(raw: string): { marks: number | null; absent: boolean } | "invalid" {
  const v = raw.trim();
  if (v === "") return { marks: null, absent: false };
  if (/^ab$/i.test(v)) return { marks: null, absent: true };
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return "invalid";
  return { marks: Number(v), absent: false };
}

export function formatCell(cell: { marks: number | null; absent: boolean }): string {
  if (cell.absent) return "AB";
  return cell.marks === null ? "" : String(cell.marks);
}

const same = (a: TestMarkInput | undefined, b: TestMarkInput) =>
  !!a && a.absent === b.absent && a.marks === b.marks;

/**
 * What saving must write: a changed entered cell is an upsert, a cell that had
 * a mark and is now blank is a delete, an unchanged cell writes nothing. A
 * mark above the test's maximum is refused here with the number, before the
 * CHECK would refuse it with a constraint name.
 */
export function planTestMarks(
  before: TestMarkInput[],
  after: TestMarkInput[],
  max: number,
): { ok: true; upserts: TestMarkInput[]; deletes: string[] } | { ok: false; error: string } {
  const was = new Map(before.map((r) => [r.studentId, r]));
  const upserts: TestMarkInput[] = [];
  const deletes: string[] = [];
  for (const row of after) {
    const entered = row.absent || row.marks !== null;
    const prior = was.get(row.studentId);
    const hadEntry = !!prior && (prior.absent || prior.marks !== null);
    if (entered) {
      if (!row.absent && (row.marks! < 0 || row.marks! > max)) {
        return { ok: false, error: `A mark must be between 0 and ${max}.` };
      }
      if (!same(prior, row)) upserts.push(row);
    } else if (hadEntry) {
      deletes.push(row.studentId);
    }
  }
  return { ok: true, upserts, deletes };
}
