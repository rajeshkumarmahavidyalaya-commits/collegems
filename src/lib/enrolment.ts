/**
 * An enrolment is on its year's roll when it is active, promoted or repeated
 * (0356). Promotion marks the year it closes `promoted` or `repeated`, so a
 * read that asked only for `active` showed a closed year's classes as empty.
 * `withdrawn` and `transferred_out` mean the child left. The same list is in
 * the SQL read models 0356 rewrote; tests/academics/earlier-year.test.ts keeps
 * the two together.
 */
export const ON_ROLL = ["active", "promoted", "repeated"] as const;
