/**
 * Behaviour and skills (0303): the grade scale and the one rule for turning an
 * edited grid into writes. No imports, so the grid, the report card and a test
 * can all read it without pulling anything into the bundle.
 */

/** CBSE's five-point co-scholastic scale, stored and printed as the letter. */
export const BEHAVIOUR_GRADES = ["A", "B", "C", "D", "E"] as const;
export type BehaviourGrade = (typeof BEHAVIOUR_GRADES)[number];

export const GRADE_MEANING: Record<BehaviourGrade, string> = {
  A: "Outstanding",
  B: "Very good",
  C: "Good",
  D: "Fair",
  E: "Needs improvement",
};

export function isGrade(value: unknown): value is BehaviourGrade {
  return typeof value === "string" && (BEHAVIOUR_GRADES as readonly string[]).includes(value);
}

/** `studentId:traitId` -> grade. An absent key is "not graded". */
export type GradeMap = Record<string, BehaviourGrade>;

export const cellKey = (studentId: string, traitId: string) => `${studentId}:${traitId}`;

/**
 * What saving an edited grid must write: every cell whose grade changed, as an
 * upsert, and every cell that was graded and has been cleared, as a delete.
 * An unchanged cell writes nothing, so reopening a class to fix one grade is
 * one write, not three hundred -- the remark sheet's rule, per cell.
 */
export function planBehaviourSave(
  initial: GradeMap,
  draft: GradeMap,
): { upserts: { studentId: string; traitId: string; grade: BehaviourGrade }[]; deletes: { studentId: string; traitId: string }[] } {
  const upserts: { studentId: string; traitId: string; grade: BehaviourGrade }[] = [];
  const deletes: { studentId: string; traitId: string }[] = [];
  const split = (key: string) => {
    const [studentId, traitId] = key.split(":");
    return { studentId, traitId };
  };
  for (const [key, grade] of Object.entries(draft)) {
    if (initial[key] !== grade) upserts.push({ ...split(key), grade });
  }
  for (const key of Object.keys(initial)) {
    if (!(key in draft)) deletes.push(split(key));
  }
  return { upserts, deletes };
}
