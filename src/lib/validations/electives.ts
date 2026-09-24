/**
 * Elective choices (migration 0282): the shapes the two screens read, and the
 * sentences they say. No imports, so both screens -- one of them a student's,
 * on a phone -- carry nothing but this.
 */

export type ElectiveOption = { subjectId: string; name: string; code: string | null; chosen: boolean };

export type ElectiveGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  isOpen: boolean;
  closesOn: string | null;
  options: ElectiveOption[];
};

export type MySubjects =
  | { enrolled: false }
  | {
      enrolled: true;
      studentId: string;
      classLabel: string;
      compulsory: { id: string; name: string; code: string | null }[];
      groups: ElectiveGroup[];
    };

export type GroupOverview = {
  id: string;
  name: string;
  classLevelId: string;
  classLevel: string;
  min: number;
  max: number;
  isOpen: boolean;
  closesOn: string | null;
  enrolled: number;
  chosen: number;
  options: { subjectId: string; name: string; count: number }[];
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const optStr = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function parseMySubjects(value: unknown): MySubjects {
  const v = obj(value);
  if (v.enrolled !== true) return { enrolled: false };
  return {
    enrolled: true,
    studentId: str(v.studentId),
    classLabel: str(v.classLabel),
    compulsory: arr(v.compulsory).map(obj).map((s) => ({ id: str(s.id), name: str(s.name), code: optStr(s.code) })),
    groups: arr(v.groups).map(obj).map((g) => ({
      id: str(g.id),
      name: str(g.name),
      min: num(g.min),
      max: num(g.max),
      isOpen: g.isOpen === true,
      closesOn: optStr(g.closesOn),
      options: arr(g.options).map(obj).map((o) => ({
        subjectId: str(o.subjectId),
        name: str(o.name),
        code: optStr(o.code),
        chosen: o.chosen === true,
      })),
    })),
  };
}

export function parseOverview(value: unknown): GroupOverview[] {
  return arr(value).map(obj).map((g) => ({
    id: str(g.id),
    name: str(g.name),
    classLevelId: str(g.classLevelId),
    classLevel: str(g.classLevel),
    min: num(g.min),
    max: num(g.max),
    isOpen: g.isOpen === true,
    closesOn: optStr(g.closesOn),
    enrolled: num(g.enrolled),
    chosen: num(g.chosen),
    options: arr(g.options).map(obj).map((o) => ({ subjectId: str(o.subjectId), name: str(o.name), count: num(o.count) })),
  }));
}

/** "Choose 2", "Choose 1 or 2", "Choose up to 3" -- the rule, said once. */
export function choiceRule(min: number, max: number): string {
  const s = (n: number) => `${n} ${n === 1 ? "subject" : "subjects"}`;
  if (min === max) return `Choose ${s(max)}`;
  if (min === 0) return `Choose up to ${s(max)}`;
  return `Choose ${min} to ${s(max)}`;
}

/**
 * Whether a selection may be saved, and if not, why -- the same count rule
 * `subject_choice_save` enforces, for the button. The function stays the gate.
 */
export function selectionProblem(count: number, min: number, max: number): string | null {
  if (count > max) return `Only ${max} can be chosen. Untick ${count - max}.`;
  if (count < min) {
    const left = min - count;
    return `Choose ${left} more ${left === 1 ? "subject" : "subjects"}.`;
  }
  return null;
}

/** "41 of 60 have chosen" with the agreement done in one place (rule 2, 0196). */
export function progressSentence(chosen: number, enrolled: number): string {
  if (enrolled === 0) return "Nobody is enrolled in this class this year";
  if (chosen === 0) return `None of ${enrolled} ${enrolled === 1 ? "student has" : "students have"} chosen yet`;
  if (chosen >= enrolled) return enrolled === 1 ? "The one student has chosen" : `All ${enrolled} students have chosen`;
  return `${chosen} of ${enrolled} ${enrolled === 1 ? "student has" : "students have"} chosen`;
}
