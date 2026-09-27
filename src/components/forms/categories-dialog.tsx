"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Tags } from "lucide-react";
import { Button } from "@/components/ui/button";

type Result = { ok: boolean; error?: string };

/**
 * The trigger for a short named list somebody adds to, renames and prunes
 * (0289): book categories and store categories. The actions are props (rule
 * 8's split) -- each module's server action keeps its own policy and its own
 * sentence about what deleting leaves behind.
 *
 * Only the button is in the page's bundle. The dialog is fetched on the click
 * that opens it: a conditional render is not a conditional load, and importing
 * it statically cost `/inventory` 22 kB for a dialog most visits never open.
 */
const Body = dynamic(() => import("./categories-dialog-body"));

export function CategoriesDialog(props: {
  title: string;
  description: string;
  categories: { id: string; name: string }[];
  save: (name: string, id?: string) => Promise<Result>;
  remove: (id: string) => Promise<Result>;
  /** What happens to things in a deleted category, for the confirmation. */
  deleteNote: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        <Tags className="size-4" aria-hidden="true" />
        Categories
      </Button>
      {mounted && <Body {...props} open={open} onOpenChange={setOpen} />}
    </>
  );
}
