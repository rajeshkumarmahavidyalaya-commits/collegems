import { Settings2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { parseSetupProgress } from "@/lib/validations/setup";
import { SetupWizard } from "@/components/dashboard/setup-wizard";
import { PageToolbar } from "@/components/page-toolbar";

export const metadata = { title: "School setup wizard" };

/**
 * The reference's setup wizard. `setup_progress()` is a definer that answers
 * only the steps the caller holds the permission for, one per step (0284), so
 * a person who may configure nothing is told so rather than shown a list of
 * screens that would refuse them.
 */
export default async function SetupPage() {
  const [supabase, t] = await Promise.all([createClient(), getT()]);
  const { data, error } = await supabase.rpc("setup_progress");
  return (
    <div className="flex flex-col gap-5">
      <PageToolbar title={t("setup.title")} icon={Settings2} />
      <p className="text-muted-foreground">{t("setup.intro")}</p>
      {error ? (
        <p role="alert" className="text-destructive">
          {t("setup.loadError", { message: error.message })}
        </p>
      ) : (
        <SetupWizard steps={parseSetupProgress(data)} />
      )}
    </div>
  );
}
