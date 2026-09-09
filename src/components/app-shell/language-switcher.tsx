"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, localeName, type Locale } from "@/lib/i18n/config";
import { setLocale } from "@/lib/i18n/actions";
import { useI18n } from "@/components/providers/i18n-provider";

/**
 * Every language is written **in itself**. A person who cannot read the current
 * language cannot find "Hindi" in a list written in English, which is the one
 * thing this control has to get right.
 */
export function LanguageSwitcher({
  schoolLocale,
  showLabel = false,
}: {
  schoolLocale?: Locale;
  /**
   * Show the current language's own name beside the globe.
   *
   * Off in the app shell, where the header is tight and everything around it
   * is already in a language the person has chosen. **On at the login page**,
   * which is the one screen where the reader may not be able to read anything
   * else on it: a bare globe asks them to guess, and `اردو` does not.
   */
  showLabel?: boolean;
}) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale | null) {
    startTransition(async () => {
      const result = await setLocale(next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        t("app.language.saved", {
          name: next ? localeName(next) : localeName(schoolLocale ?? "en"),
        }),
      );
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={showLabel ? "sm" : "icon"}
          aria-label={t("app.language.choose")}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Globe className="size-4" aria-hidden="true" />
          )}
          {showLabel && (
            // Written in its own language and its own direction, for the same
            // reason the menu items are.
            <span dir={LOCALES.find((l) => l.code === locale)?.direction}>
              {LOCALES.find((l) => l.code === locale)?.nativeName ?? localeName(locale)}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("app.language.choose")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LOCALES.map((entry) => (
          <DropdownMenuItem
            key={entry.code}
            onSelect={() => choose(entry.code)}
            // The item is written in its own language and its own direction, so
            // اردو reads correctly inside an English menu.
            dir={entry.direction}
            className="flex items-center justify-between gap-2"
          >
            <span>{entry.nativeName}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{entry.englishName}</span>
              {locale === entry.code && <Check className="size-4" aria-hidden="true" />}
            </span>
          </DropdownMenuItem>
        ))}
        {schoolLocale && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => choose(null)}>
              {t("app.language.followSchool", { name: localeName(schoolLocale) })}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
