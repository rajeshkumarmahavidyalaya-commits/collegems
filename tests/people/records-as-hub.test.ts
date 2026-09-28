import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PARAM_TYPES } from "@/lib/validations/reports";

/**
 * The record is the hub (0296): a bus seat, a hostel bed and a library card
 * from the person's own page and at admission; a route in one form; the bus
 * list on the school's day; and a transport report by route and vehicle.
 */
const ROOT = process.cwd();
const DIR = join(ROOT, "supabase/migrations");
const strip = (s: string) => s.replace(/--.*$/gm, "");
const SQL = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ f, sql: strip(readFileSync(join(DIR, f), "utf8")) }));

function latest(name: string): { file: string; header: string; body: string } {
  for (const { f, sql } of [...SQL].reverse()) {
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    const m = [...sql.matchAll(re)].pop();
    if (!m) continue;
    const start = sql.indexOf("$$", m.index!);
    const end = sql.indexOf("$$", start + 2);
    return { file: f, header: sql.slice(m.index!, start), body: sql.slice(start + 2, end) };
  }
  throw new Error(`${name} is defined nowhere`);
}

const src = (p: string) =>
  readFileSync(join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const m296 = SQL.find((s) => s.f.startsWith("0296_"))!.sql;

describe("a route in one form (0296)", () => {
  it("creates the route and its first stop in one invoker function", () => {
    const { header, body } = latest("transport_route_create");
    expect(header).not.toMatch(/security definer/);
    expect(body).toMatch(/insert into public\.transport_routes/);
    expect(body).toMatch(/insert into public\.route_stops/);
    expect(body).not.toMatch(/tenant_id\s*=/);
    expect(m296).toMatch(/revoke all on function public\.transport_route_create\(jsonb, jsonb\) from public, anon;/);
  });

  it("refuses a first stop with no fare rather than inventing one", () => {
    expect(latest("transport_route_create").body).toMatch(/if v_fare is null or v_fare < 0 then\s+raise exception/);
  });

  it("the dialog creates through it, and an edit keeps the route's fee head", () => {
    const dialog = src("src/app/(app)/transport/transport-dialogs.tsx");
    expect(dialog).toMatch(/await createRoute\(/);
    // `feeHeadId: ""` on an edit cleared the head on every save.
    expect(dialog).toMatch(/feeHeadId: route\?\.feeHeadId \?\?/);
    expect(src("src/app/(app)/transport/actions.ts")).toMatch(/feeHeadId: headOf\.get\(r\.route_id\) \?\? null/);
  });
});

describe("the bus list (0296)", () => {
  it("lists a seat only between the day it starts and the day it ends, on the school's day", () => {
    const { body } = latest("transport_manifest");
    expect(body).toMatch(/ta\.starts_on <= public\.mobile_today\(\)/);
    expect(body).toMatch(/ta\.effective_ends_on >= public\.mobile_today\(\)/);
    expect(body).not.toMatch(/current_date/);
  });

  it("keeps the staff who ride it: a rider is a row with a name", () => {
    const detail = src("src/app/(app)/transport/[routeId]/route-detail.tsx");
    expect(detail).toMatch(/rows\.filter\(\(r\) => r\.studentName !== null\)/);
    expect(detail).not.toMatch(/rows\.filter\(\(r\) => r\.studentId !== null\)/);
  });
});

describe("who rides which bus (0296)", () => {
  it("is a catalogue row on the permission that acts on it, for staff", () => {
    expect(m296).toMatch(/'transport\.riders',[\s\S]*?'transport\.assign',\s*'report_transport_riders'/);
    expect(m296).toMatch(/75,\s*'staff'\s*\)/);
  });

  it("is an invoker with a total order and no hand tenant filter", () => {
    const { header, body } = latest("report_transport_riders");
    expect(header).not.toMatch(/security definer/);
    expect(body).not.toMatch(/tenant_id\s*=/);
    expect(body).toMatch(/order by r\.code, rs\.sequence, \(ta\.staff_id is not null\), sort_rider, ta\.id/);
  });

  it("filters by route and vehicle, and the runner can draw both", () => {
    expect(PARAM_TYPES).toContain("route");
    expect(PARAM_TYPES).toContain("vehicle");
    const runner = src("src/app/(app)/reports/report-runner.tsx");
    expect(runner).toMatch(/descriptor\.type === "route"/);
    expect(runner).toMatch(/descriptor\.type === "vehicle"/);
    const actions = src("src/app/(app)/reports/actions.ts");
    // Routes belong to a year: last year's R1 beside this year's is two identical labels.
    expect(actions).toMatch(/from\("transport_routes"\)\.select\("id, code, name"\)\.eq\("session_id", sessionId\)/);
  });
});

describe("the record is the hub (0296)", () => {
  const actions = src("src/app/(app)/students/arrangement-actions.ts");

  it("writes only through the modules' own functions, never a raw insert", () => {
    expect(actions).toMatch(/rpc\("transport_assign_student"/);
    expect(actions).toMatch(/rpc\("transport_assign_staff"/);
    expect(actions).toMatch(/rpc\("hostel_allocate"/);
    expect(actions).toMatch(/await createMember\(/);
    expect(actions).not.toMatch(/\.insert\(/);
  });

  it("the controls take their actions as props and decide nothing about who may (rule 8)", () => {
    const controls = src("src/components/people/arrange-controls.tsx");
    expect(controls).not.toMatch(/from "@\/app\//);
    expect(controls).not.toMatch(/hasPermission|roleCode|roleTier/);
  });

  it("the student record asks the one definition of current and draws each button on its write permission", () => {
    const page = src("src/app/(app)/students/[id]/page.tsx");
    expect(page).toMatch(/isCurrentArrangement\(r, schoolDay\)/);
    expect(page).toMatch(/hasPermission\("transport\.assign"\)/);
    expect(page).toMatch(/hasPermission\("hostel\.allocate"\)/);
    expect(page).toMatch(/hasPermission\("library\.manage"\)/);
    expect(page).toMatch(/giveBusSeat\.bind\(null, "student", student\.id\)/);
    expect(page).toMatch(/giveBed\.bind\(null, student\.id\)/);
    expect(page).toMatch(/giveLibraryCard\.bind\(null, "student", student\.id\)/);
  });

  it("the staff record gives a seat and a card, and a staff login sees its own bus", () => {
    const page = src("src/app/(app)/staff/[id]/page.tsx");
    expect(page).toMatch(/giveBusSeat\.bind\(null, "staff", staff\.id\)/);
    expect(page).toMatch(/giveLibraryCard\.bind\(null, "staff", staff\.id\)/);
    // "No seat" to a caller who may not read seats would be the policy speaking.
    expect(page).toMatch(/\{canSeeTransport && \(/);
    expect(src("src/app/(app)/account/page.tsx")).toMatch(/currentStaffSeat\(ctx\.staffId\)/);
    expect(src("src/app/(app)/transport/actions.ts")).toMatch(/isCurrentArrangement\(r, day\)/);
  });

  it("admission can put a child on a bus and in a bed, and a refusal never un-admits them", () => {
    const admit = src("src/app/(app)/students/actions.ts");
    const body = admit.slice(admit.indexOf("export async function admitStudent"));
    const seat = body.indexOf('rpc("transport_assign_student"');
    const commit = body.indexOf('rpc("admit_student"');
    expect(seat).toBeGreaterThan(commit);
    expect(body).toMatch(/No bus seat: \$\{seat\.error\.message\}/);
    expect(body).toMatch(/No hostel bed: \$\{bed\.error\.message\}/);
    // Offered only to somebody who may assign them.
    const page = src("src/app/(app)/students/new/page.tsx");
    expect(page).toMatch(/canAssignBus \? busStopOptions\(\) : Promise\.resolve\(\[\]\)/);
    expect(page).toMatch(/canAllocateBed \? bedOptions\(\) : Promise\.resolve\(\[\]\)/);
  });
});
