import { getT } from "@/lib/i18n/server";
import { getPalette } from "@/lib/theme/server";
import { AppearancePicker } from "./appearance-picker";

export const metadata = { title: "Appearance" };

/**
 * How the application looks to the person reading it: a colour palette and
 * light or dark. A property of the person, like their language (rule 15), so it
 * lives in a cookie of theirs and changes nothing for anybody else.
 */
export default async function AppearancePage() {
  const [t, palette] = await Promise.all([getT(), getPalette()]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("settings.appearance.title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("settings.appearance.body")}</p>
      </div>
      <AppearancePicker current={palette} />
    </div>
  );
}
