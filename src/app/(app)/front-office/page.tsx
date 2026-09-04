import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../students/actions";
import { listStaffOptions } from "../hr/actions";
import { getFunnel, listClassLevelOptions, listEnquiries, listVisitors } from "./actions";
import { FrontOfficeView } from "./front-office-view";

export const metadata = { title: "Front office" };

export default async function FrontOfficePage() {
  const [ctx, canView, canManage, canAdmit] = await Promise.all([
    getUserContext(),
    hasPermission("frontoffice.view"),
    hasPermission("frontoffice.manage"),
    hasPermission("frontoffice.admit"),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Front office</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Enquiries hold a child&apos;s date of birth and a family&apos;s phone number before either
          has any relationship with the school, so the register is kept to the office. Ask an
          administrator for <code className="font-mono">frontoffice.view</code>.
        </p>
      </div>
    );
  }

  const [enquiries, funnel, visitors, classLevels, sections, staff] = await Promise.all([
    listEnquiries(),
    getFunnel(),
    listVisitors(false),
    listClassLevelOptions(),
    listSections(),
    listStaffOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Front office</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The admissions funnel for {ctx?.currentSessionName ?? "the current session"}, and who is in
          the building. An enquiry is not a student record until somebody admits it — which is one
          click, through the same path the office already uses.
        </p>
      </div>

      <FrontOfficeView
        enquiries={enquiries}
        funnel={funnel}
        visitors={visitors}
        classLevels={classLevels}
        sections={sections}
        staff={staff}
        canManage={canManage}
        canAdmit={canAdmit}
      />
    </div>
  );
}
