import type { ColumnDef } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Row-selection checkboxes.
 *
 * The labels are parameters rather than `useT()` calls because this builds a
 * column definition at module scope, where a hook has no component to belong
 * to. Pass `t("table.selectAll")` and `t("table.selectRow")` from the client
 * component that owns the table.
 */
export function selectColumn<TData>(labels: {
  all: string;
  row: string;
}): ColumnDef<TData, unknown> {
  return {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label={labels.all}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        onClick={(e) => e.stopPropagation()}
        aria-label={labels.row}
      />
    ),
    enableSorting: false,
    enableHiding: false,
    size: 32,
  };
}
