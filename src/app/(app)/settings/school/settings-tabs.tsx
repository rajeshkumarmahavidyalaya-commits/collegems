"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/components/providers/i18n-provider";
import type { SettingRow } from "./actions";
import { SettingsList } from "./settings-list";

/**
 * The reference shows school settings as tabs. The tabs are the modules the
 * settings catalogue actually declares (rule 12), never a fixed list of the
 * reference's own -- a tab with nothing behind it would be a control that does
 * nothing.
 */
export function SettingsTabs({ settings, canManage }: { settings: SettingRow[]; canManage: boolean }) {
  const t = useT();
  const modules = [...new Set(settings.map((s) => s.module))];
  if (!modules.length) return <p className="text-muted-foreground">{t("settings.none")}</p>;
  return (
    <Tabs defaultValue={modules[0]}>
      <TabsList>
        {modules.map((module) => (
          <TabsTrigger key={module} value={module}>
            {module}
          </TabsTrigger>
        ))}
      </TabsList>
      {modules.map((module) => (
        <TabsContent key={module} value={module} className="pt-4">
          <SettingsList settings={settings.filter((s) => s.module === module)} canManage={canManage} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
