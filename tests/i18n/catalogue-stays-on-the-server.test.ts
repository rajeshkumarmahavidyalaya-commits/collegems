import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { clientMessagesFor, createTranslator } from "@/lib/i18n/translate";
import { translatorFrom } from "@/lib/i18n/translator";
import { LOCALES } from "@/lib/i18n/config";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Import statements that bring in a value, not only types. */
function valueImports(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/^import\s+(?!type\s)([\s\S]*?)\s+from\s+"([^"]+)";?$/gm)) {
    // `import { type A, type B } from` brings in nothing at run time either.
    const names = m[1].replace(/^\{|\}$/g, "").split(",").map((n) => n.trim()).filter(Boolean);
    if (m[1].startsWith("{") && names.every((n) => n.startsWith("type "))) continue;
    out.push(m[2]);
  }
  return out;
}

const CATALOGUE = /(^|\/)i18n\/(translate|messages\/(en|hi|ur))$|^\.\/messages\/(en|hi|ur)$|^\.\/translate$/;

/**
 * The i18n catalogue is 101.6 kB of three languages. It reached the browser on
 * 64 routes because the client provider imported `translate.ts`. The provider
 * now receives one locale's messages as a prop, and this guard keeps any client
 * module from importing a catalogue by value again -- which would compile, pass
 * everything else, and put the 101.6 kB back silently.
 */
describe("the catalogue stays on the server", () => {
  it("no client module imports a catalogue by value", () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      const isClient = /^\s*["']use client["']/.test(source) || file.endsWith("lib/i18n/translator.ts");
      if (!isClient) continue;
      for (const spec of valueImports(source)) {
        if (CATALOGUE.test(spec)) offenders.push(`${relative(ROOT, file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the provider takes its messages as a prop and builds from translator.ts", () => {
    const provider = readFileSync(join(SRC, "components", "providers", "i18n-provider.tsx"), "utf8");
    expect(provider).toContain('from "@/lib/i18n/translator"');
    expect(provider).toMatch(/translatorFrom\(locale, messages\)/);
    const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
    expect(layout).toContain("messages={clientMessagesFor(locale)}");
  });

  it.each(LOCALES.map((l) => l.code))("%s: the browser's translator answers every key as the server's does", (locale) => {
    const server = createTranslator(locale);
    const browser = translatorFrom(locale, clientMessagesFor(locale));
    const keys = Object.keys(clientMessagesFor("en"));
    expect(keys.length).toBeGreaterThan(100);
    for (const key of keys) {
      expect(browser(key as never, { n: 3, name: "Asha", count: 2 })).toBe(
        server(key as never, { n: 3, name: "Asha", count: 2 }),
      );
    }
    for (const key of ["onlineTests.question", "sitting.left", "notices.readCount"]) {
      expect(browser.plural(key, 1)).toBe(server.plural(key, 1));
      expect(browser.plural(key, 5)).toBe(server.plural(key, 5));
    }
  });
});
