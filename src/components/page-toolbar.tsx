import type { ReactNode } from "react";
import { LayoutDashboard, type LucideIcon } from "lucide-react";

/**
 * The reference's green module title bar: the page's heading on the left and
 * its main actions on the right. It renders the page's one `<h1>`, so a page
 * using it does not draw another.
 */
export function PageToolbar({
  title,
  icon: Icon = LayoutDashboard,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  children?: ReactNode;
}) {
  return (
    <div className="page-toolbar" data-print="hide">
      <h1>
        <Icon className="size-5" aria-hidden="true" />
        {title}
      </h1>
      {children && <div className="page-toolbar-actions">{children}</div>}
    </div>
  );
}
