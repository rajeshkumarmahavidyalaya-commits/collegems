"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { Lock, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isLastWayBack, type PermissionMatrix } from "@/lib/validations/permissions";
import { setPermission } from "./actions";

/**
 * Roles down the modules, permissions down the page, one checkbox per cell.
 *
 * Two things about the shape:
 *
 * - **The grid is wide and the table scrolls inside its own container.** 64
 *   permissions by six roles does not fold into a phone, and the alternative —
 *   a role picker and one column at a time — hides the comparison, which is the
 *   whole reason somebody opens this screen ("why can the librarian do that and
 *   the accountant not?").
 * - **A cell is saved when it is clicked.** There is no Save button, so there
 *   is no half-applied form to lose; each checkbox is one row in one table and
 *   one audit entry.
 */
export function PermissionGrid({
  matrix,
  canManage,
}: {
  matrix: PermissionMatrix;
  canManage: boolean;
}) {
  const [granted, setGranted] = useState(matrix.granted);
  const [optimistic, applyOptimistic] = useOptimistic(
    granted,
    (state: Record<string, string[]>, change: { roleId: string; code: string; allowed: boolean }) => {
      const current = state[change.roleId] ?? [];
      return {
        ...state,
        [change.roleId]: change.allowed
          ? [...current, change.code]
          : current.filter((c) => c !== change.code),
      };
    },
  );
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");

  const modules = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return matrix.modules;
    return matrix.modules
      .map((m) => ({
        ...m,
        permissions: m.permissions.filter(
          (p) =>
            p.code.toLowerCase().includes(needle) ||
            m.module.toLowerCase().includes(needle) ||
            (p.description ?? "").toLowerCase().includes(needle),
        ),
      }))
      .filter((m) => m.permissions.length > 0);
  }, [matrix.modules, query]);

  function toggle(roleId: string, code: string, allowed: boolean) {
    startTransition(async () => {
      applyOptimistic({ roleId, code, allowed });
      const result = await setPermission(roleId, code, allowed);

      if (!result.ok) {
        // The trigger's own sentence, unedited: it was written for whoever just
        // clicked, and paraphrasing it here would be a second copy of a rule.
        toast.error(result.error);
        return;
      }

      setGranted((state) => {
        const current = state[roleId] ?? [];
        return {
          ...state,
          [roleId]: allowed ? [...current, code] : current.filter((c) => c !== code),
        };
      });
    });
  }

  const total = matrix.modules.reduce((n, m) => n + m.permissions.length, 0);
  const shown = modules.reduce((n, m) => n + m.permissions.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="permission-search" className="text-xs">
            Find a permission
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="permission-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="fees, library, attendance…"
              className="ps-8 sm:w-72"
            />
          </div>
        </div>
        <p className="pb-2 text-sm text-muted-foreground" aria-live="polite">
          {shown === total ? `${total} permissions` : `${shown} of ${total} permissions`}
        </p>
      </div>

      {modules.length === 0 ? (
        <div className="rounded-lg border border-border py-14 text-center">
          <p className="text-sm font-medium">Nothing matches “{query}”</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a module name — fees, library, attendance, payroll.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead className="sticky top-0 bg-muted/50">
              <tr>
                <th scope="col" className="p-3 text-start font-medium">
                  Permission
                </th>
                {matrix.roles.map((role) => (
                  <th key={role.id} scope="col" className="p-3 text-center font-medium">
                    <span className="block">{role.name}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {TIER_LABEL[role.tier]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            {modules.map((m) => (
              <tbody key={m.module} className="border-t border-border">
                <tr className="bg-muted/30">
                  <th
                    scope="colgroup"
                    colSpan={matrix.roles.length + 1}
                    className="p-2 px-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {m.module}
                  </th>
                </tr>

                {m.permissions.map((p) => (
                  <tr key={p.code} className="border-t border-border/60">
                    <th scope="row" className="p-3 text-start font-normal">
                      <span className="block font-mono text-xs">{p.code}</span>
                      {p.description && (
                        <span className="block text-xs text-muted-foreground">{p.description}</span>
                      )}
                    </th>

                    {matrix.roles.map((role) => {
                      const held = (optimistic[role.id] ?? []).includes(p.code);
                      const keystone = isLastWayBack(
                        { granted: optimistic, keystonePermission: matrix.keystonePermission },
                        role.id,
                        p.code,
                      );

                      return (
                        <td key={role.id} className="p-3 text-center">
                          <span className="inline-flex items-center gap-1.5">
                            <Checkbox
                              checked={held}
                              disabled={!canManage || keystone}
                              onCheckedChange={(next) => toggle(role.id, p.code, next === true)}
                              aria-label={`${role.name}: ${p.code}`}
                            />
                            {/* Not colour alone: the lock is drawn and named,
                                because "you cannot clear this one" is the
                                whole message. */}
                            {keystone && (
                              <Lock
                                className="size-3 text-muted-foreground"
                                aria-label="the last role that can open this screen"
                              />
                            )}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="gap-1">
          <Lock className="size-3" aria-hidden="true" />
          locked
        </Badge>
        <span>
          The last role holding <span className="font-mono">{matrix.keystonePermission}</span> keeps
          it: clearing it would leave nobody able to open this screen and give it back. Grant it to
          another role first.
        </span>
      </div>
    </div>
  );
}

/**
 * The audience a role belongs to, as a word under its name.
 *
 * Presentation, exactly as `roles.tier` is meant to be — it tells the person
 * editing who a column is *for*, and decides nothing. The checkbox below it is
 * what decides.
 */
const TIER_LABEL: Record<string, string> = {
  staff: "Staff",
  student: "Students and families",
  principal: "Runs the college",
};
