import type { ReactNode } from "react";
import { Users, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageToolbar } from "@/components/page-toolbar";
import type { FamilyChild } from "@/lib/auth/family";
import { ChildPicker } from "./child-picker";

/**
 * The frame every family page draws: the title bar with the child picker, and
 * the two empty states that are not "nothing here".
 *
 * A member of staff has no children here (`family_my_students()` answers
 * `[]`), and is told the page is for families rather than shown an empty one.
 * A family login linked to nobody is told to ask the office.
 */
export function FamilyFrame({
  title,
  icon,
  childList,
  child,
  isFamily,
  actions,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  childList: FamilyChild[];
  child: FamilyChild | null;
  isFamily: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageToolbar title={title} icon={icon}>
        {actions}
        {isFamily && childList.length > 1 && child && (
          <ChildPicker
            selected={child.studentId}
            options={childList.map((c) => ({ studentId: c.studentId, name: c.name, sectionLabel: c.sectionLabel }))}
          />
        )}
      </PageToolbar>
      {!isFamily ? (
        <EmptyCard
          title="This page is for families"
          body="It shows one child's own record. The office's screens for the whole college are in the menu."
        />
      ) : !child ? (
        <EmptyCard
          title="No children are linked to this login yet"
          body="The college office links a family login to the children it belongs to. Ask them if this looks wrong."
        />
      ) : (
        <>
          {childList.length > 1 && (
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{child.name}</span>
              {child.sectionLabel ? `, ${child.sectionLabel}` : ""}.
            </p>
          )}
          {children}
        </>
      )}
    </div>
  );
}

export function EmptyCard({ title, body, icon: Icon = Users }: { title: string; body: string; icon?: LucideIcon }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <span className="rounded-full bg-muted p-3">
          <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
        </span>
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
