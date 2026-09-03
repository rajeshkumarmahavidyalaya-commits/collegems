import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../students/actions";
import { listSubjects } from "../academics/actions";
import { listStudyMaterial } from "../homework/actions";
import { MaterialList } from "./material-list";

export const metadata = { title: "Study material" };

export default async function StudyMaterialPage() {
  const [ctx, material, sections, subjects, canManage] = await Promise.all([
    getUserContext(),
    listStudyMaterial(),
    listSections(),
    listSubjects(),
    hasPermission("homework.manage"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Study material</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Worksheets, notes and recordings for {ctx?.currentSessionName ?? "this session"}. Files
          are private: a download is signed for the person who asked, ten minutes at a time, after
          the database has confirmed they may see it.
        </p>
      </div>

      <MaterialList
        material={material}
        sections={sections.map((s) => ({ value: s.id, label: s.label }))}
        subjects={subjects.map((s) => ({ value: s.id, label: s.name }))}
        canManage={canManage}
      />
    </div>
  );
}
