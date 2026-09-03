"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Film,
  Link2,
  Library,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BUCKET_LIMITS, BUCKETS } from "@/lib/storage/constants";
import { MATERIAL_KINDS, materialKindLabel } from "@/lib/validations/homework";
import {
  deleteStudyMaterial,
  materialDownloadUrl,
  saveStudyMaterial,
  setMaterialPublished,
  type StudyMaterialRow,
} from "../homework/actions";

type Option = { value: string; label: string };

type Props = {
  material: StudyMaterialRow[];
  sections: Option[];
  subjects: Option[];
  canManage: boolean;
};

const KIND_ICON = { document: FileText, video: Film, link: Link2 } as const;

export function MaterialList({ material, sections, subjects, canManage }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function togglePublished(row: StudyMaterialRow) {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await setMaterialPublished(row.id, !row.isPublished);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(row.isPublished ? "Hidden from families." : "Published.");
      router.refresh();
    });
  }

  function download(row: StudyMaterialRow) {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await materialDownloadUrl(row.id);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    });
  }

  function remove(row: StudyMaterialRow) {
    if (!window.confirm(`Delete "${row.title}"? The file goes with it, and that cannot be undone.`)) {
      return;
    }
    setBusyId(row.id);
    startTransition(async () => {
      const result = await deleteStudyMaterial(row.id);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Deleted.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Study material</CardTitle>
          <CardDescription className="max-w-2xl">
            One item is one thing — a worksheet, a recording, a page on the web. An item with no
            class is for the whole school; one with no subject is general.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add material
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {material.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Library className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">Nothing here yet</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {canManage
                  ? "Upload a worksheet or link a recording. Draft items stay on your shelf until you publish them."
                  : "When your teachers publish worksheets or recordings, they appear here."}
              </p>
            </div>
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                <Plus className="size-4" aria-hidden="true" />
                Add material
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Kind</TableHead>
                  {canManage && <TableHead>Visibility</TableHead>}
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {material.map((row) => {
                  const Icon = KIND_ICON[row.kind as keyof typeof KIND_ICON] ?? FileText;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <span className="flex items-start gap-2">
                          <Icon
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="min-w-0">
                            <span className="block font-medium">{row.title}</span>
                            {row.description && (
                              <span className="block text-xs text-muted-foreground">
                                {row.description}
                              </span>
                            )}
                            {row.fileName && (
                              <span className="block font-mono text-xs text-muted-foreground">
                                {row.fileName} · {row.sizeLabel}
                              </span>
                            )}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.sectionLabel}</TableCell>
                      <TableCell className="text-muted-foreground">{row.subjectName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {materialKindLabel(row.kind)}
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          <Badge variant={row.isPublished ? "default" : "outline"}>
                            {row.isPublished ? "Published" : "Draft"}
                          </Badge>
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {row.externalUrl ? (
                            <Button
                              asChild
                              variant="ghost"
                              size="icon"
                              aria-label={`Open ${row.title} in a new tab`}
                            >
                              <a
                                href={row.externalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="size-4" aria-hidden="true" />
                              </a>
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={pending && busyId === row.id}
                              onClick={() => download(row)}
                              aria-label={`Download ${row.title}`}
                            >
                              <Download className="size-4" aria-hidden="true" />
                            </Button>
                          )}
                          {canManage && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={pending && busyId === row.id}
                                onClick={() => togglePublished(row)}
                                aria-label={
                                  row.isPublished
                                    ? `Hide ${row.title} from families`
                                    : `Publish ${row.title}`
                                }
                              >
                                {row.isPublished ? (
                                  <EyeOff className="size-4" aria-hidden="true" />
                                ) : (
                                  <Eye className="size-4" aria-hidden="true" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={pending && busyId === row.id}
                                onClick={() => remove(row)}
                                aria-label={`Delete ${row.title}`}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <MaterialDialog open={open} onOpenChange={setOpen} sections={sections} subjects={subjects} />
    </Card>
  );
}

/**
 * A plain `FormData` submission rather than react-hook-form, because a `File`
 * is not serialisable through a resolver's value and the schema deliberately
 * cannot see it. The action completes the check the schema cannot — see
 * `study_material_source_chk`.
 */
function MaterialDialog({
  open,
  onOpenChange,
  sections,
  subjects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: Option[];
  subjects: Option[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState("document");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const limits = BUCKET_LIMITS[BUCKETS.studyMaterial];

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("kind", kind);

    startTransition(async () => {
      const result = await saveStudyMaterial(data);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      setErrors({});
      toast.success("Added.");
      formRef.current?.reset();
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add study material</DialogTitle>
          <DialogDescription>
            A file or a link, never both. Leave it unpublished while you are still deciding.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="material-title">
              Title
              <span aria-hidden="true" className="text-destructive"> *</span>
            </Label>
            <Input
              id="material-title"
              name="title"
              required
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "material-title-error" : undefined}
            />
            {errors.title && (
              <p id="material-title-error" className="text-sm text-destructive">
                {errors.title[0]}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="material-description">Description</Label>
            <Textarea id="material-description" name="description" rows={3} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="material-kind">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="material-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIAL_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {MATERIAL_KINDS.find((k) => k.value === kind)?.hint}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="material-section">Class</Label>
              <SelectWithHidden
                id="material-section"
                name="sectionId"
                placeholder="Whole school"
                options={sections}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="material-subject">Subject</Label>
            <SelectWithHidden
              id="material-subject"
              name="subjectId"
              placeholder="General"
              options={subjects}
            />
          </div>

          {kind === "document" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="material-file">
                File
                <span aria-hidden="true" className="text-destructive"> *</span>
              </Label>
              <Input
                id="material-file"
                name="file"
                type="file"
                accept={limits.accept.join(",")}
                aria-invalid={errors.file ? true : undefined}
                aria-describedby="material-file-hint"
              />
              <p id="material-file-hint" className="text-xs text-muted-foreground">
                Up to {Math.round(limits.maxBytes / (1024 * 1024))} MB.
                {errors.file && (
                  <span className="block text-destructive">{errors.file[0]}</span>
                )}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="material-url">
                Web address
                <span aria-hidden="true" className="text-destructive"> *</span>
              </Label>
              <Input
                id="material-url"
                name="externalUrl"
                type="url"
                placeholder="https://…"
                aria-invalid={errors.externalUrl ? true : undefined}
                aria-describedby={errors.externalUrl ? "material-url-error" : undefined}
              />
              {errors.externalUrl && (
                <p id="material-url-error" className="text-sm text-destructive">
                  {errors.externalUrl[0]}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <Label htmlFor="material-published" className="text-sm font-medium">
              Publish to families now
            </Label>
            <Switch id="material-published" name="isPublished" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Uploading…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A shadcn `Select` renders a button, not an `<input>`, so nothing reaches
 * `FormData` on its own. The hidden input is what makes the choice submittable
 * — and the empty value is meaningful here ("whole school", "general"), so it
 * is a real option rather than the absence of one.
 */
function SelectWithHidden({
  id,
  name,
  placeholder,
  options,
}: {
  id: string;
  name: string;
  placeholder: string;
  options: Option[];
}) {
  const [value, setValue] = useState("");

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select value={value || "__none"} onValueChange={(v) => setValue(v === "__none" ? "" : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
