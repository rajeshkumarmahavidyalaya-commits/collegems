"use client";

import { useState } from "react";
import type { Table } from "@tanstack/react-table";
import { Bookmark, Columns3, Download, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSavedViews, type SavedViewState } from "./use-saved-views";

export function DataTableToolbar<TData>({
  table,
  viewsKey,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
  onExport,
  children,
}: {
  table: Table<TData>;
  viewsKey?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  onExport?: () => void;
  children?: React.ReactNode;
}) {
  const [newViewName, setNewViewName] = useState("");
  const savedViews = useSavedViews(viewsKey ?? "");

  const currentState: SavedViewState = {
    sorting: table.getState().sorting,
    columnVisibility: table.getState().columnVisibility,
    columnFilters: table.getState().columnFilters,
  };

  return (
    <div className="flex flex-wrap items-center gap-2 pb-3">
      {onSearchChange && (
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchValue ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
            aria-label={searchPlaceholder}
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {children}

      <div className="ml-auto flex items-center gap-2">
        {viewsKey && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Bookmark className="size-3.5" aria-hidden="true" />
                Views
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Saved views</DropdownMenuLabel>
              {savedViews.views.length === 0 && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">No saved views yet</p>
              )}
              {savedViews.views.map((view) => (
                <DropdownMenuItem
                  key={view.name}
                  className="justify-between"
                  onSelect={(e) => {
                    e.preventDefault();
                    table.setSorting(view.state.sorting);
                    table.setColumnVisibility(view.state.columnVisibility);
                    table.setColumnFilters(view.state.columnFilters);
                  }}
                >
                  <span>{view.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      savedViews.remove(view.name);
                    }}
                    className="text-muted-foreground hover:text-destructive cursor-pointer"
                    aria-label={`Delete view ${view.name}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <div className="flex items-center gap-1 p-1.5">
                <Input
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  placeholder="Name this view"
                  className="h-8"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!newViewName.trim()}
                  onClick={() => {
                    savedViews.save(newViewName.trim(), currentState);
                    setNewViewName("");
                  }}
                >
                  Save
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="size-3.5" aria-hidden="true" />
            Export
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 className="size-3.5" aria-hidden="true" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {(column.columnDef.meta as { label?: string } | undefined)?.label ?? column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
