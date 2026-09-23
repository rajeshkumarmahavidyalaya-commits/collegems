import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIVE_CLASS_URL_PATTERNS,
  joinState,
  lessonStatusLabel,
  scheduleSchema,
} from "@/lib/validations/live-classes";
import type { Translator } from "@/lib/i18n/translate";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function sql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function files(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

/** The latest definition, anchored on `create ... function`. */
function functionBody(name: string): string {
  let found = "";
  for (const file of files()) {
    const body = sql(readFileSync(join(MIGRATIONS, file), "utf8"));
    const pattern = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(body)) !== null) {
      const rest = body.slice(m.index);
      found = rest.slice(0, rest.indexOf("\n$$;"));
    }
  }
  return found;
}

const table = sql(
  readFileSync(join(MIGRATIONS, "0270_a_live_class_is_a_lesson_with_an_address.sql"), "utf8"),
);

/**
 * Live classes (migrations 0270-0272): a lesson for one class, on a date, with
 * an address the college vouches for.
 */
describe("the address is an allowlist", () => {
  it.each(Object.entries(LIVE_CLASS_URL_PATTERNS))(
    "%s: the browser's pattern is the CHECK's, character for character",
    (provider, pattern) => {
      // The CHECK is the gate and this copy is the courtesy; a copy is only
      // safe to keep while something fails when the two drift.
      const checked = table.match(new RegExp(`when '${provider}'\\s+then join_url ~ '([^']+)'`));
      expect(checked, `no CHECK branch for ${provider}`).not.toBeNull();
      expect(pattern.source.replace(/\\\//g, "/")).toBe(checked![1]);
    },
  );

  it.each([
    ["zoom", "https://zoom.us.evil.example/j/12345678901"],
    ["zoom", "https://evil.example/?u=https://zoom.us/j/12345678901"],
    ["meet", "https://meet.google.com.evil.example/abc-defg-hij"],
    ["meet", "http://meet.google.com/abc-defg-hij"],
    ["teams", "https://teams.microsoft.com.evil.example/l/meetup-join/x"],
    ["jitsi", "https://meet.jit.si/anything-somebody-typed"],
  ] as const)("refuses the look-alike %s link %s", (provider, url) => {
    expect(LIVE_CLASS_URL_PATTERNS[provider].test(url)).toBe(false);
  });

  it.each([
    ["zoom", "https://us02web.zoom.us/j/12345678901?pwd=AbC.12_x-y"],
    ["zoom", "https://zoom.us/j/123456789"],
    ["meet", "https://meet.google.com/abc-defg-hij"],
    ["teams", "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d"],
    ["jitsi", "https://meet.jit.si/SchoolOSb03793adb661cfddbc6019f1"],
  ] as const)("accepts a real %s link", (provider, url) => {
    expect(LIVE_CLASS_URL_PATTERNS[provider].test(url)).toBe(true);
  });

  it("the schema refuses a link pasted under the wrong provider", () => {
    const base = { course: `${"a".repeat(8)}-aaaa-aaaa-aaaa-${"a".repeat(12)}:${"b".repeat(8)}-bbbb-bbbb-bbbb-${"b".repeat(12)}`, title: "Fractions", date: "2026-10-01", time: "10:00", minutes: "45" };
    expect(scheduleSchema.safeParse({ ...base, provider: "meet", joinUrl: "https://zoom.us/j/123456789" }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...base, provider: "zoom", joinUrl: "https://zoom.us/j/123456789" }).success).toBe(true);
    expect(scheduleSchema.safeParse({ ...base, provider: "jitsi" }).success).toBe(true);
  });

  it("a Jitsi room is made by the database from random bytes, never typed", () => {
    const body = functionBody("live_class_schedule");
    expect(body).toContain("'https://meet.jit.si/SchoolOS' || encode(extensions.gen_random_bytes(12), 'hex')");
  });
});

describe("the menu and the boundary agree", () => {
  it("can_manage asks the write policy's question: the course's teacher now, not the one frozen on the lesson", () => {
    // 0271: the first read model compared `lc.teacher_staff_id`, and a teacher
    // who could cancel a lesson was drawn no Cancel button. Verified by
    // restoring 0270's predicate, which fails this.
    const body = functionBody("live_classes_between");
    expect(body).toContain("up.staff_id = ss.teacher_staff_id");
    expect(body).not.toMatch(/up\.staff_id\s*=\s*lc\.teacher_staff_id/);
  });

  it("the course list asks which years have not ended, not which year is flagged", () => {
    // 0274 moved the definition to `teaching_courses()`, its second consumer
    // being the online tests; the live-class name wraps it and must stay one.
    const body = functionBody("teaching_courses");
    expect(body).toMatch(/a\.end_date\s*>=/);
    expect(body).not.toContain("is_current");
    expect(body).toContain("up.staff_id = ss.teacher_staff_id");
    expect(functionBody("live_class_courses")).toMatch(/select \* from public\.teaching_courses\(\)\s*$/);
  });

  it("the page writes times where the college is, not where the server is", () => {
    const page = readFileSync(join(ROOT, "src", "app", "(app)", "live-classes", "page.tsx"), "utf8");
    expect(page).toContain("timeZone: l.timezone");
  });
});

describe("joinState", () => {
  const lesson = { status: "scheduled", startsAt: "2026-10-01T04:30:00Z", endsAt: "2026-10-01T05:30:00Z" };
  const at = (iso: string) => Date.parse(iso);

  it.each([
    ["2026-10-01T04:14:59Z", "early"],
    ["2026-10-01T04:15:00Z", "open"], // fifteen minutes before
    ["2026-10-01T05:29:59Z", "open"],
    ["2026-10-01T05:30:00Z", "ended"],
  ])("at %s it is %s", (now, expected) => {
    expect(joinState(lesson, at(now))).toBe(expected);
  });

  it("a cancelled lesson is never joinable", () => {
    expect(joinState({ ...lesson, status: "cancelled" }, at("2026-10-01T04:45:00Z"))).toBe("cancelled");
  });

  it("an unknown status is shown as the database wrote it", () => {
    const t = ((key: string) => key) as unknown as Translator;
    expect(lessonStatusLabel("postponed", t)).toBe("postponed");
    expect(lessonStatusLabel("cancelled", t)).toBe("Cancelled");
  });
});
