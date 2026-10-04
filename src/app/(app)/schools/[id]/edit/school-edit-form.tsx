"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ImageUp, Loader2, Save, School, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { copySchoolSetup, updateSchool, type SchoolProfileForm } from "../../actions";

const PROFILE_FIELDS: [string, string, string][] = [
  ["address_line1", "Address line 1", "text"],
  ["address_line2", "Address line 2", "text"],
  ["city", "City", "text"],
  ["state", "State", "text"],
  ["postal_code", "PIN code", "text"],
  ["phone", "Phone", "tel"],
  ["email", "Email", "email"],
  ["website", "Website", "url"],
];

const MENU: [string, string][] = [
  ["library", "Library"],
  ["transport", "Transport"],
  ["hostel", "Hostel"],
  ["inventory", "Store and stock"],
  ["exams", "Examination"],
  ["accounts", "Accounts"],
  ["payroll", "Payroll"],
  ["certificates", "Certificates"],
  ["homework", "Homework"],
  ["live_classes", "Live classes"],
];

/**
 * Shrink a picked image to at most 256 px on its longer side and encode it as
 * a data URL the tenants CHECK accepts (PNG, JPEG or WebP, 200,000
 * characters). Done in the browser so a 4 MB photograph never leaves it.
 */
async function toLogo(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let url = canvas.toDataURL("image/png");
  if (url.length > 190_000) url = canvas.toDataURL("image/jpeg", 0.85);
  if (url.length > 190_000) url = canvas.toDataURL("image/jpeg", 0.6);
  if (url.length > 190_000) throw new Error("That image is still too large after shrinking. Try a simpler logo.");
  return url;
}

export function SchoolEditForm({
  school,
  copySources,
}: {
  school: SchoolProfileForm;
  copySources: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState(school.name);
  const [profile, setProfile] = useState<Record<string, string>>(school.profile);
  const [menu, setMenu] = useState<Record<string, boolean>>(
    Object.fromEntries(MENU.map(([k]) => [k, school.menu[k] !== false])),
  );
  const [logo, setLogo] = useState<string | null>(school.logo);
  const [logoChange, setLogoChange] = useState<"keep" | "" | string>("keep");
  const [from, setFrom] = useState(copySources[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [copying, startCopy] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function save(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await updateSchool({ tenantId: school.tenantId, name, profile, logo: logoChange, menu });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.data.name} saved.`);
      setLogoChange("keep");
      router.refresh();
    });
  }

  function copy() {
    const source = copySources.find((s) => s.id === from);
    if (!source) return;
    if (!window.confirm(`Copy classes, sections, subjects, periods, fee heads and amounts from ${source.name} into ${school.name}? No student, staff member or payment is copied.`)) return;
    startCopy(async () => {
      const r = await copySchoolSetup(from, school.tenantId);
      if (!r.ok) return void toast.error(r.error);
      const d = r.data;
      toast.success(`Copied from ${source.name}`, {
        description: `${d.classes ?? 0} classes, ${d.sections ?? 0} sections, ${d.subjects ?? 0} subjects, ${d.periods ?? 0} periods, ${d.fee_heads ?? 0} fee heads and ${d.fee_amounts ?? 0} fee amounts.`,
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={save} className="flex flex-col gap-5" noValidate>
        <section className="rounded-lg border bg-card p-5" aria-labelledby="school-details">
          <h2 id="school-details" className="mb-4 border-b pb-3 text-lg font-semibold">
            School details
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="school-name">
                School name <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input id="school-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required />
              <p className="text-xs text-muted-foreground">Web address: {school.slug} (permanent)</p>
            </div>
            {PROFILE_FIELDS.map(([key, label, type]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`school-${key}`}>{label}</Label>
                <Input
                  id={`school-${key}`}
                  type={type}
                  value={profile[key] ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5" aria-labelledby="school-logo">
          <h2 id="school-logo" className="mb-4 border-b pb-3 text-lg font-semibold">
            Logo
          </h2>
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex size-20 items-center justify-center overflow-hidden rounded-lg border bg-muted">
              {logo ? (
                // A data URL the browser made; next/image adds nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt={`${name} logo`} className="size-full object-contain" />
              ) : (
                <School className="size-8 text-muted-foreground" aria-hidden="true" />
              )}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              id="school-logo-file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const url = await toLogo(file);
                  setLogo(url);
                  setLogoChange(url);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "That image could not be read.");
                }
              }}
            />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              <ImageUp className="size-4" aria-hidden="true" />
              {logo ? "Change logo" : "Upload logo"}
            </Button>
            {logo && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setLogo(null);
                  setLogoChange("");
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Remove
              </Button>
            )}
            <p className="w-full text-xs text-muted-foreground">
              PNG, JPEG or WebP. It is shrunk to 256 pixels and shown on the school&apos;s card.
            </p>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5" aria-labelledby="school-menu">
          <h2 id="school-menu" className="mb-1 text-lg font-semibold">
            Menu show
          </h2>
          <p className="mb-4 border-b pb-3 text-sm text-muted-foreground">
            Modules switched off are left out of this school&apos;s menu. Their pages still check their own
            permissions, and nothing is deleted.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MENU.map(([key, label]) => (
              <li key={key} className="flex items-center gap-3">
                <Switch id={`menu-${key}`} checked={menu[key]} onCheckedChange={(v) => setMenu((m) => ({ ...m, [key]: v }))} />
                <Label htmlFor={`menu-${key}`} className="font-normal">
                  {label}
                </Label>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
            Save school
          </Button>
        </div>
      </form>

      <section className="rounded-lg border bg-card p-5" aria-labelledby="school-copy">
        <h2 id="school-copy" className="mb-1 text-lg font-semibold">
          Copy setup from another school
        </h2>
        {school.classCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            This school already has {school.classCount} {school.classCount === 1 ? "class" : "classes"}, so its setup is
            not replaced. Copying is for a new school.
          </p>
        ) : copySources.length === 0 ? (
          <p className="text-sm text-muted-foreground">You administer no other school to copy from.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <p className="w-full text-sm text-muted-foreground">
              Classes, this year&apos;s sections and subjects, periods, weekends, fee heads, regular fee amounts and
              grading schemes. Never a student, a staff member, a payment or a record.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="copy-from">Copy from</Label>
              <select
                id="copy-from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 min-w-56 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {copySources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" variant="outline" onClick={copy} disabled={copying || !from}>
              {copying ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              Copy setup
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
