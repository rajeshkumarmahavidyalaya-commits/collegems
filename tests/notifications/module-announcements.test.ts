import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0316: transport, hostel, promotion and front office announce. Probed live in
 * a rolled-back transaction: an online application reached the college's 3
 * administrators; a bus seat reached the one child who can sign in, reading
 * "Atharv has a seat on City Centre from Station Road at 07:05".
 */
const M = readFileSync(join(process.cwd(), "supabase/migrations/0316_the_modules_that_did_not_tell_anybody.sql"), "utf8")
  .replace(/--.*$/gm, "");

const body = (fn: string) => {
  const i = M.indexOf(`create or replace function public.${fn}(`);
  return M.slice(i, M.indexOf("$$;", i));
};

describe("modules that tell the people concerned", () => {
  it("a seat and a bed announce from a trigger, so every path that makes one does", () => {
    expect(M).toMatch(/after insert on public\.transport_assignments\s+for each row execute function public\.transport_announce_seat\(\);/);
    expect(M).toMatch(/after insert on public\.hostel_allocations\s+for each row execute function public\.hostel_announce_bed\(\);/);
  });

  it("a failed announcement never undoes the arrangement", () => {
    for (const fn of ["transport_announce_seat", "hostel_announce_bed", "enquiries_announce_online"]) {
      expect(body(fn), fn).toMatch(/exception when others then\s+raise warning/);
    }
  });

  it("a staff seat is not announced, and nobody holding a JWT can call a trigger function", () => {
    expect(body("transport_announce_seat")).toMatch(/if new\.student_id is null or new\.status <> 'active' then\s+return new;/);
    for (const fn of ["transport_announce_seat", "hostel_announce_bed", "enquiries_announce_online"]) {
      expect(M).toContain(`revoke all on function public.${fn}() from public, anon, authenticated;`);
    }
  });

  it("promotion is announced by somebody who may run one, in words true of every family", () => {
    expect(body("promotion_announce")).toMatch(/role_has_permission\('promotion\.manage'\)/);
    expect(body("promotion_announce")).not.toMatch(/promoted to/i);
  });

  it("only the online form's own rows are announced to the office", () => {
    expect(body("enquiries_announce_online")).toMatch(/new\.source <> 'website' or auth\.uid\(\) is not null/);
  });
});
