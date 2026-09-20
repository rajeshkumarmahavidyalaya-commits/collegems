import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The exam seat plan.
 *
 * What is worth guarding here is not that the module exists. It is the handful
 * of things that would be wrong **invisibly** — each of which this module got
 * wrong once, and each of which was found by probing rather than by reading:
 *
 *   - **the read gate.** `0249` gated the tenant-wide read on `exams.view`,
 *     which is the permission that lets a family see their own child's result.
 *     Probed as a candidate: 302 seats visible, draft included. Re-introducing
 *     it would compile, pass every other test, and publish the whole college's
 *     plan to every family.
 *   - **`run_status`.** It is what the candidate's policy compares to keep a
 *     draft private and what the write policy compares to freeze a published
 *     plan. Both are one clause away from doing nothing.
 *   - **the row count.** `exam_seat_move` returned `{"moved": true}` having
 *     changed 0 rows, because a permissive policy that matches nothing does
 *     not refuse — it silently grants nothing.
 *   - **`planned_capacity` staying out of a composite key**, which is what
 *     lets a room be refurbished without rewriting a plan from a past year.
 *
 * Every assertion reads a file, so this runs without a database, and each was
 * verified by planting the violation.
 */

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

/**
 * Comments stripped, both syntaxes. This file's prose quotes `exams.view` and
 * `on update cascade` while explaining why neither belongs here, so a guard
 * that read the prose would report on itself — which has happened four times
 * in this codebase now.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** The highest-numbered definition wins: migrations are immutable. */
function latestDefinition(name: string): string {
  const sql = code(migrationSql());
  const marker = new RegExp(`create (?:or replace )?function public\\.${name}\\(`, "g");
  const starts = [...sql.matchAll(marker)].map((m) => m.index ?? -1);
  expect(starts.length, `no migration defines public.${name}`).toBeGreaterThan(0);
  const start = starts[starts.length - 1];
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end === -1 ? undefined : end);
}

/**
 * The live text of a policy: its last `create policy` wins, and a `drop policy`
 * before it is exactly how 0253 re-gated these. Anchored on the statement, not
 * on the name appearing somewhere.
 */
function latestPolicy(name: string, table: string): string {
  const sql = code(migrationSql());
  const marker = new RegExp(
    `create policy "${name}" on public\\.${table}[\\s\\S]*?;`,
    "g",
  );
  const all = [...sql.matchAll(marker)].map((m) => m[0]);
  expect(all.length, `no migration creates policy "${name}" on ${table}`).toBeGreaterThan(0);
  return all[all.length - 1];
}

describe("a seating plan is not staff-room reading", () => {
  it("gates the tenant-wide read on exams.seating, never on exams.view", () => {
    // The defect 0253 fixed. `exams.view` is held by admin, teacher, parent
    // AND student, so a tenant-wide policy gated on it is the whole college's
    // plan published to every family.
    for (const table of ["exam_seat_plans", "exam_seat_allocations"]) {
      const policy = latestPolicy(`staff view ${table}`, table);
      expect(policy, `${table}: the wide read must be gated on exams.seating`)
        .toContain("role_has_permission('exams.seating')");
      expect(policy, `${table}: exams.view is the family's permission, not a staff gate`)
        .not.toContain("exams.view");
    }
  });

  it("grants exams.seating to the roles that run exams, not to admin by name", () => {
    const sql = code(migrationSql());
    const grant = sql.slice(sql.indexOf("insert into public.role_permissions"));
    expect(grant).toContain("'exams.seating'");
    // 0213's rule: a college may have granted a permission to somebody other
    // than its administrator, so a new code follows the matrix rather than a
    // hardcoded role.
    expect(
      /permission_code\s*=\s*'exams\.grade'/.test(grant),
      "exams.seating must be granted by reading the matrix, not by naming a role",
    ).toBe(true);
  });

  it("shows a candidate only a published seat, and only their own", () => {
    const own = latestPolicy("students view own exam seat", "exam_seat_allocations");
    expect(own).toContain("run_status = 'published'");
    expect(own).toContain("up.student_id");

    const guardian = latestPolicy("parents view own children exam seats", "exam_seat_allocations");
    expect(guardian).toContain("run_status = 'published'");
    expect(guardian).toContain("guardian_student");
  });

  it("freezes a published plan through run_status, in both halves of the write policy", () => {
    const write = latestPolicy("exam officers write draft seat allocations", "exam_seat_allocations");
    // Both halves: `using` decides which rows may be touched and `with check`
    // decides what they may become. One without the other is a gap.
    const halves = write.match(/run_status = 'draft'/g) ?? [];
    expect(halves.length, "the draft-only clause must be in USING and WITH CHECK")
      .toBeGreaterThanOrEqual(2);
  });
});

describe("the seat is a number, and the number is the capacity rule", () => {
  const sql = code(migrationSql());

  it("bounds seat_no by the frozen capacity and makes the seat unique", () => {
    // Together these two are the capacity constraint, declaratively: numbered
    // occupants cannot outnumber their numbers, so no advisory lock is needed.
    expect(sql).toContain("check (seat_no <= planned_capacity)");
    expect(sql).toMatch(
      /unique \(tenant_id, plan_id, room_id, seat_no\)/,
      );
  });

  it("keeps planned_capacity out of every composite foreign key", () => {
    // Rule 4's second boundary. With ON UPDATE CASCADE, refurbishing a room
    // would rewrite a plan from a previous year; without one, the refurbishment
    // would be refused while any historical plan referenced it. It is a frozen
    // plain column, and the critic reports when it disagrees with the room.
    const keys = sql.match(/foreign key \([^)]*planned_capacity[^)]*\)/g) ?? [];
    expect(keys, "planned_capacity is a record of a day, not a child kept in step")
      .toEqual([]);
  });

  it("holds run_status equal to the plan's with a cascade", () => {
    // The other half of the same device, used for the thing it IS for.
    const fk = sql.slice(sql.indexOf("constraint exam_seat_allocations_plan_fkey"));
    expect(fk.slice(0, 300)).toContain("references public.exam_seat_plans (tenant_id, id, status)");
    expect(fk.slice(0, 300)).toContain("on update cascade");
  });

  it("makes one-live-plan-per-sitting NULLS NOT DISTINCT", () => {
    // Without it, a college that sets no exam periods — which is every plan
    // here, on 96 of 96 dated papers — has a null in the index and two drafts
    // for one morning are both allowed. The index would protect nobody
    // precisely at the college that has the default configuration.
    const idx = sql.slice(sql.indexOf("create unique index exam_seat_plans_one_live"));
    expect(idx.slice(0, 400)).toContain("nulls not distinct");
  });
});

describe("the write functions assert what they changed", () => {
  it("checks the row count after every UPDATE in exam_seat_move", () => {
    // 0254. `{"moved": true}` with 0 rows changed is worse than an error: the
    // officer is told the candidate was moved.
    const body = latestDefinition("exam_seat_move");
    const updates = (body.match(/update public\.exam_seat_allocations/g) ?? []).length;
    const checks = (body.match(/get diagnostics v_n = row_count/g) ?? []).length;
    expect(updates, "exam_seat_move should still perform the move and the swap").toBe(2);
    expect(checks, "every UPDATE must assert its own row count").toBe(updates);
    // And the state is named before the permission, so the ordinary case gets
    // the sentence that names the officer's next action.
    expect(body).toContain("v_alloc.run_status <> 'draft'");
  });

  it("checks the row count in publish, unpublish and discard", () => {
    for (const fn of [
      "exam_seat_plan_publish",
      "exam_seat_plan_unpublish",
      "exam_seat_plan_discard",
    ]) {
      const body = latestDefinition(fn);
      expect(body, `${fn} must assert the row count`).toContain("get diagnostics");
      expect(body, `${fn} must raise rather than return a quiet success`).toContain("raise exception");
    }
  });
});

describe("the critic measures the arrangement, not the algorithm", () => {
  const body = latestDefinition("exam_seating_problems");

  it("refuses a caller without the permission instead of returning nothing", () => {
    // An empty answer from a critic is indistinguishable from a plan with
    // nothing wrong with it, which is the failure being removed.
    expect(body).toContain("role_has_permission('exams.manage')");
    expect(body).toContain("raise exception");
  });

  it("narrows the wide side before reporting a candidate as no longer sitting", () => {
    // `exam_seat_allocations` is readable tenant-wide by anybody holding
    // exams.seating; the candidate list is row-scoped through `enrolments`.
    // A `not exists` across those two accuses a class teacher's screen of 277
    // candidates who are sitting perfectly normally — attendance_coverage's
    // lesson, which cost this codebase two migrations elsewhere.
    const stale = body.slice(body.indexOf("v_stale"));
    expect(stale).toContain("from public.enrolments e");
    expect(stale).toContain("e.student_id = a.student_id");
  });

  it("counts adjacency from the rows, and only consecutive seats", () => {
    const adjacency = body.slice(body.indexOf("v_adjacent"));
    // Read from exam_seat_allocations — the arrangement as it stands after the
    // officer has moved people — never from anything the generator returned.
    expect(adjacency).toContain("from public.exam_seat_allocations");
    // A held-back seat between two candidates is a gap: they are next in the
    // room and are not sitting together.
    expect(adjacency).toContain("next_seat = seat_no + 1");
  });

  it("says that nothing records who elected an optional paper", () => {
    // `is_optional` exists on 12 papers and no table anywhere maps a child to
    // the optional paper they chose, so the candidate list for one is the whole
    // section. Naming it is the honest half; guessing would be the other kind.
    expect(body).toContain("c.is_optional");
    expect(body.toLowerCase()).toContain("elective register");
  });
});

describe("the read models stay invoker, and stay out of the tenant's way", () => {
  it("never filters by tenant_id by hand", () => {
    // Rule 11: invoker + RLS is what makes a read model unable to cross
    // tenants. A hand-written filter in eight functions is one the ninth
    // forgets — and here it would also silently do nothing useful.
    for (const fn of ["exam_seat_chart", "exam_seat_candidates"]) {
      const body = latestDefinition(fn);
      expect(body, `${fn} must not filter by tenant_id by hand`)
        .not.toMatch(/where[\s\S]*tenant_id\s*=/);
      expect(body, `${fn} must be SECURITY INVOKER`).toContain("security invoker");
    }
  });

  it("matches a sitting's period with IS NOT DISTINCT FROM", () => {
    // `=` against a null slot matches nothing, and a null slot is what every
    // paper at this college has. The whole module would resolve zero
    // candidates and refuse every sitting with "nobody is sitting".
    expect(latestDefinition("exam_seat_candidates"))
      .toContain("es.time_slot_id is not distinct from p_time_slot_id");
  });

  it("orders the invigilator's sheet by room and seat", () => {
    // Rule 7's export note: a read model's ORDER BY is part of the contract,
    // and this one is also the physical order of the room.
    expect(latestDefinition("exam_seat_chart")).toMatch(/order by a\.room_name, a\.seat_no/);
  });
});
