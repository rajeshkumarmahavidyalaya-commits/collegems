"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/components/providers/i18n-provider";
import { PALETTES, PALETTE_COOKIE, type PaletteId } from "@/lib/theme/palettes";
import { cn } from "@/lib/utils";

/**
 * Choosing a palette writes a cookie (so the server renders it next time and
 * nothing flashes) and sets it on <html> at once, so the whole screen changes
 * under the person's finger. Each card is a real radio button inside a label,
 * so the keyboard and a screen reader get a radio group for free. A card's
 * colours come from `data-palette` on its preview -- the palette's own tokens
 * in globals.css -- never from a colour written here.
 */
export function AppearancePicker({ current }: { current: PaletteId }) {
  const t = useT();
  const [selected, setSelected] = useState<PaletteId>(current);
  const { theme, setTheme } = useTheme();
  // next-themes only knows the theme after mount; until then nothing is checked.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function choose(id: PaletteId) {
    setSelected(id);
    document.cookie = `${PALETTE_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.palette = id;
    toast.success(t("settings.appearance.saved", { name: t(`palette.${id}`) }));
  }

  const modes = [
    { id: "light", label: t("app.theme.light"), icon: Sun },
    { id: "dark", label: t("app.theme.dark"), icon: Moon },
    { id: "system", label: t("app.theme.system"), icon: Monitor },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>{t("settings.appearance.palette")}</CardTitle>
          <CardDescription>{t("settings.appearance.paletteHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset>
            <legend className="sr-only">{t("settings.appearance.palette")}</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PALETTES.map((p) => {
                const isOn = selected === p.id;
                return (
                  <label
                    key={p.id}
                    data-palette={p.id}
                    className={cn(
                      "palette-card group relative flex cursor-pointer flex-col gap-3 rounded-xl border-2 bg-card p-3 transition-shadow hover:shadow-md",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                      isOn ? "border-primary" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="palette"
                      value={p.id}
                      checked={isOn}
                      onChange={() => choose(p.id)}
                      className="sr-only"
                    />
                    {/* A miniature of the screen in this palette: the title bar,
                        a button, a highlighted row and the school band. */}
                    <span aria-hidden="true" className="flex flex-col gap-1.5 rounded-lg bg-background p-2">
                      <span className="palette-preview-bar h-5 rounded-md" />
                      <span className="flex gap-1.5">
                        <span className="h-4 w-12 rounded bg-primary" />
                        <span className="h-4 flex-1 rounded bg-accent" />
                      </span>
                      <span className="h-3 rounded bg-muted" />
                    </span>
                    <span className="flex items-center justify-between gap-2 text-sm font-medium">
                      {t(`palette.${p.id}`)}
                      {isOn && (
                        <span className="flex items-center gap-1 text-xs text-primary">
                          <Check className="size-3.5" aria-hidden="true" />
                          {t("settings.appearance.current")}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle>{t("settings.appearance.mode")}</CardTitle>
        </CardHeader>
        <CardContent>
          <fieldset>
            <legend className="sr-only">{t("settings.appearance.mode")}</legend>
            <div className="flex flex-wrap gap-3">
              {modes.map((m) => {
                const isOn = mounted && theme === m.id;
                const Icon = m.icon;
                return (
                  <label
                    key={m.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border-2 bg-card px-4 py-2.5 text-sm font-medium",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                      isOn ? "border-primary text-primary" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="theme-mode"
                      value={m.id}
                      checked={isOn}
                      onChange={() => setTheme(m.id)}
                      className="sr-only"
                    />
                    <Icon className="size-4" aria-hidden="true" />
                    {m.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </CardContent>
      </Card>
    </div>
  );
}
