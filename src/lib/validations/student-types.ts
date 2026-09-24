/**
 * Kinds of student, and what each kind pays (migration 0281).
 *
 * No imports on purpose: the fee setup screen is a client component, and one
 * `import { z }` would ship the schema library to draw a list of fees
 * (`fees-display.ts`'s warning).
 *
 * `effectiveFees` is the screen's copy of the rule `fees_billable_lines`
 * applies when it bills: a row for the student's own type **replaces** the
 * untyped row for the same class and head, and an amount of 0 exempts them.
 * It exists so a bursar can see what a carry-over student in Grade 6 pays
 * before raising a single invoice. Being a copy is exactly why it has a test:
 * `tests/fees/student-types.test.ts` pins it to the numbers probed against the
 * SQL, and checks the SQL still says the same thing.
 */

export type StudentTypeOption = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  /** Children given this type in the current year. */
  studentCount: number;
};

export type FeeRow = {
  id: string;
  amount: number;
  frequency: string;
  classLevelId: string;
  classLevel: string;
  sequence: number;
  feeHeadId: string;
  feeHead: string;
  feeHeadCode: string;
  /** Null: what every student in the class pays. */
  studentTypeId: string | null;
  studentType: string | null;
};

export type EffectiveFee = {
  row: FeeRow;
  /**
   * `regular`: the untyped amount, and the viewer is looking at regular fees.
   * `inherited`: this type has no amount of its own, so pays the regular one.
   * `own`: this type's own amount replaces the regular one.
   * `exempt`: this type's own amount is 0, so the head is not charged at all.
   */
  kind: "regular" | "inherited" | "own" | "exempt";
  /** For `own` and `exempt`: what a regular student pays for the same head. */
  regularAmount: number | null;
};

/** One class's fees as a student of `typeId` (null: a regular student) pays them. */
export function effectiveFees(rows: FeeRow[], typeId: string | null): EffectiveFee[] {
  const regular = rows.filter((r) => r.studentTypeId === null);
  if (typeId === null) {
    return regular.map((row) => ({ row, kind: "regular", regularAmount: null }));
  }
  const own = new Map(
    rows.filter((r) => r.studentTypeId === typeId).map((r) => [r.feeHeadId, r]),
  );
  const out: EffectiveFee[] = [];
  for (const row of regular) {
    const mine = own.get(row.feeHeadId);
    if (!mine) {
      out.push({ row, kind: "inherited", regularAmount: null });
    } else {
      out.push({ row: mine, kind: mine.amount > 0 ? "own" : "exempt", regularAmount: row.amount });
      own.delete(row.feeHeadId);
    }
  }
  // A head only this type pays: nothing regular to replace.
  for (const mine of own.values()) {
    out.push({ row: mine, kind: mine.amount > 0 ? "own" : "exempt", regularAmount: null });
  }
  return out;
}

/** What one class charges a student of that type, per head, added up. */
export function effectiveTotal(fees: EffectiveFee[]): number {
  return fees.reduce((sum, f) => sum + (f.kind === "exempt" ? 0 : f.row.amount), 0);
}

/**
 * Rows grouped by class, in class order. Keyed by id rather than by name: two
 * classes with one name would otherwise be merged into one card.
 */
export function byClass(rows: FeeRow[]): { classLevelId: string; classLevel: string; rows: FeeRow[] }[] {
  const groups = new Map<string, { classLevelId: string; classLevel: string; sequence: number; rows: FeeRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.classLevelId) ?? {
      classLevelId: r.classLevelId,
      classLevel: r.classLevel,
      sequence: r.sequence,
      rows: [],
    };
    g.rows.push(r);
    groups.set(r.classLevelId, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.sequence - b.sequence || a.classLevel.localeCompare(b.classLevel))
    .map(({ classLevelId, classLevel, rows }) => ({ classLevelId, classLevel, rows }));
}

/**
 * A code for a new type, from its name. The CHECK wants `^[a-z][a-z0-9_]{1,39}$`,
 * and a college names a type in its own words ("Management quota", "2nd
 * attempt"), so the code is derived rather than typed.
 */
export function studentTypeCode(name: string): string {
  let code = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 34)
    .replace(/_+$/, "");
  // A name in Devanagari or Urdu script leaves nothing behind; the caller
  // adds a number when two such codes collide.
  if (!/^[a-z]/.test(code)) code = code ? `t_${code}` : "t";
  if (code.length < 2) code = `${code}_type`;
  return code;
}

/** The sentinel a `<Select>` uses for "every student": Radix will not take "". */
export const ALL_STUDENTS = "all";
