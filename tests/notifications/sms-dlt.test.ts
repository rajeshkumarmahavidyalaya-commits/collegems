import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { templateSchema } from "@/lib/validations/notifications";

/**
 * SMS in India is a registered template (0308), pinned without a database.
 *
 * The live half was probed in a rolled-back transaction: with registration off
 * an SMS queues exactly as before; on, with no template, it is skipped with the
 * reason; a registered template re-renders the body and freezes the template
 * ID, header and PE ID; a variable the payload does not fill skips the message
 * naming it; and the critic reaches the checks page.
 */
const ROOT = process.cwd();
const DIR = join(ROOT, "supabase/migrations");
const strip = (s: string) => s.replace(/--.*$/gm, "");
const ALL = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ f, sql: strip(readFileSync(join(DIR, f), "utf8")) }));
const M = ALL.find((m) => m.f.startsWith("0308_"))!.sql;

describe("an SMS in India is a registered template", () => {
  it("one trigger decides, for every writer of an SMS delivery", () => {
    expect(M).toMatch(/before insert on public\.notification_deliveries\s+for each row execute function public\.notification_deliveries_sms_dlt\(\)/);
    // Both writers insert into the table the trigger sits on, and neither
    // carries a DLT branch of its own to drift from it.
    for (const { f, sql } of ALL.filter((m) => m.f < "0308_")) {
      expect(sql, f).not.toMatch(/sms_dlt/);
    }
  });

  it("is off by default, so a college that has not decided keeps today's behaviour", () => {
    expect(M).toMatch(/'\{"required": false\}'::jsonb/);
    expect(M).toMatch(/if coalesce\(\(v_rule ->> 'required'\)::boolean, false\) is false then\s+return new;/);
  });

  it("skips rather than queues what a carrier would drop, and freezes what the driver needs", () => {
    expect(M.match(/new\.status := 'skipped';/g)?.length).toBe(3);
    expect(M).toMatch(/new\.body := v_body;/);
    expect(M).toMatch(/'template_id', v_tpl\.provider_template_name/);
    expect(M).toMatch(/'header', btrim\(v_rule ->> 'header'\)/);
  });

  it("holds a DLT template ID to 19 digits, in the table and in the form", () => {
    expect(M).toMatch(/provider_template_name ~ '\^\[0-9\]\{19\}\$'/);
    const base = { eventKey: "fees.reminder", channel: "sms" as const, body: "Dear parent", isActive: true };
    expect(templateSchema.safeParse({ ...base, providerTemplateName: "1107161234567890123" }).success).toBe(true);
    expect(templateSchema.safeParse({ ...base, providerTemplateName: "fee_reminder" }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, providerTemplateName: "" }).success).toBe(true);
    // Email still has no provider template at all.
    expect(
      templateSchema.safeParse({ ...base, channel: "email", providerTemplateName: "1107161234567890123" }).success,
    ).toBe(false);
  });

  it("the driver sends under the frozen header and, through MSG91, the frozen template ID", () => {
    const drivers = readFileSync(join(ROOT, "supabase/functions/notify-dispatch/drivers.ts"), "utf8");
    expect(drivers).toMatch(/const from = dlt\?\.header \?\? fromAddress/);
    expect(drivers).toMatch(/DLT_TE_ID: dlt\.template_id/);
    expect(drivers).toMatch(/sender: dlt\.header/);
  });

  it("the critic is catalogued, for the permission that can fix it", () => {
    expect(M).toMatch(/'sms_dlt_problems',\s+'severity_message',\s+'Notifications',\s+'\/notifications\/log',\s+'settings\.manage'/);
  });
});
