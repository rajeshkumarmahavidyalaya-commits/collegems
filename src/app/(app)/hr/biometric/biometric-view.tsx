"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Fingerprint, Loader2, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { BIOMETRIC_CODE_PATTERN, exampleRequest } from "@/lib/validations/biometric-display";
import {
  registerDevice,
  retireDevice,
  setStaffCode,
  type Device,
  type Problem,
  type Punch,
  type StaffCode,
} from "./actions";

/** A punch with its names resolved and its time written where the college is. */
export type ShownPunch = Punch & { device: string; person: string | null; when: string };

export function BiometricView({
  devices,
  staff,
  punches,
  problems,
  endpoint,
}: {
  devices: Device[];
  staff: StaffCode[];
  punches: ShownPunch[];
  problems: Problem[];
  endpoint: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      {problems.length > 0 ? (
        <section aria-labelledby="problems-heading" className="rounded-lg border border-border p-4">
          <h2 id="problems-heading" className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4 text-brand-accent" aria-hidden="true" />
            Needs attention
          </h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {problems.map((p) => (
              <li key={`${p.kind}:${p.subject}`}>
                {p.kind === "unmatched" ? (
                  <>
                    Code <bdi className="font-mono">{p.subject}</bdi> matches nobody on the staff
                    list — {p.detail}. Give it to the right person below.
                  </>
                ) : (
                  <>
                    <bdi>{p.subject}</bdi> {p.detail}. Check it is switched on and connected.
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Devices devices={devices} endpoint={endpoint} />
      <StaffCodes staff={staff} />
      <RecentPunches punches={punches} />
    </div>
  );
}

function Devices({ devices, endpoint }: { devices: Device[]; endpoint: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(null);
  const [retiring, setRetiring] = useState<Device | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setName("");
    setError(null);
    // Forgotten on close, deliberately: the secret is shown once.
    setCreated(null);
  }

  function register(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await registerDevice({ name });
      if (!result.ok) {
        setError(result.fieldErrors?.name?.[0] ?? result.error);
        return;
      }
      setCreated(result.data);
      router.refresh();
    });
  }

  function retire(device: Device) {
    startTransition(async () => {
      const result = await retireDevice(device.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${device.name} is retired. Anything it sends from now on is refused.`);
      setRetiring(null);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="devices-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="devices-heading" className="text-lg font-semibold">
          Readers
        </h2>
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
          Register a reader
        </Button>
      </div>

      {devices.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <Fingerprint className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="max-w-md text-sm text-muted-foreground">
            No reader is registered. Register one to get the address and secret it posts punches to.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium break-words">{d.name}</span>
                <span className="font-mono text-xs break-all text-muted-foreground">{d.id}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={d.isActive ? "secondary" : "outline"}>
                  {d.isActive ? "Active" : "Retired"}
                </Badge>
                {d.isActive ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setRetiring(d)}>
                    <Power aria-hidden="true" />
                    Retire
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>Set up the reader</DialogTitle>
                <DialogDescription>
                  Copy the secret now. It is shown this once and stored only as a fingerprint of
                  itself — if it is lost, retire the reader and register it again.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 text-sm">
                <CopyLine label="Address" value={endpoint} />
                <CopyLine label="Reader id" value={created.id} />
                <CopyLine label="Secret" value={created.secret} />
                <div className="flex flex-col gap-1">
                  <span className="font-medium">An example request</span>
                  <pre
                    dir="ltr"
                    className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"
                  >
                    {exampleRequest(endpoint, created.id, created.secret)}
                  </pre>
                  <p className="text-muted-foreground">
                    Send each punch&apos;s time with its offset (+05:30). Up to 500 punches in one
                    request; sending the same punch twice records it once.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" onClick={close}>
                  I have copied it
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={register} className="flex flex-col gap-4" noValidate>
              <DialogHeader>
                <DialogTitle>Register a reader</DialogTitle>
                <DialogDescription>
                  Name it for where it stands, so a quiet reader is easy to find.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reader-name">Name</Label>
                <Input
                  id="reader-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder="Main gate"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "reader-name-error" : undefined}
                  required
                />
                {error ? (
                  <p id="reader-name-error" role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>
                  Close
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  Register
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={retiring !== null} onOpenChange={(o) => !o && setRetiring(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retire {retiring?.name}</DialogTitle>
            <DialogDescription>
              It stops being accepted at once. The punches it has already sent, and the register
              rows made from them, stay as they are.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRetiring(null)}>
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => retiring && retire(retiring)}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Retire
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error("Could not copy. Select the text and copy it by hand.");
            }
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

function StaffCodes({ staff }: { staff: StaffCode[] }) {
  return (
    <section aria-labelledby="codes-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="codes-heading" className="text-lg font-semibold">
          Who is who on the reader
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The number each person is enrolled under on the reader. A punch whose code matches nobody
          is kept and listed above, and marks nobody present.
        </p>
      </div>
      {staff.length === 0 ? (
        <p className="text-sm text-muted-foreground">There is nobody on the staff list yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {staff.map((s) => (
            <StaffCodeRow key={s.staffId} row={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StaffCodeRow({ row }: { row: StaffCode }) {
  const router = useRouter();
  const [value, setValue] = useState(row.code ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = value.trim() !== (row.code ?? "");
  const inputId = `code-${row.staffId}`;

  function save(event: React.FormEvent) {
    event.preventDefault();
    const code = value.trim();
    if (code !== "" && !BIOMETRIC_CODE_PATTERN.test(code)) {
      setError("Letters, digits, - and _ only, up to 32 characters.");
      return;
    }
    startTransition(async () => {
      const result = await setStaffCode({ staffId: row.staffId, code });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      toast.success(code ? `${row.name} is code ${code} on the reader.` : `${row.name} is off the reader.`);
      router.refresh();
    });
  }

  return (
    <li className="p-3">
      <form onSubmit={save} className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="flex min-w-0 flex-1 basis-48 flex-col text-sm">
          <span className="font-medium break-words">{row.name}</span>
          <span className="text-xs text-muted-foreground">{row.employeeCode}</span>
        </label>
        <Input
          id={inputId}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          maxLength={32}
          dir="ltr"
          className="w-36 font-mono"
          placeholder="Not enrolled"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        <Button type="submit" variant="outline" size="sm" disabled={!changed || pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Save
        </Button>
        {error ? (
          <p id={`${inputId}-error`} role="alert" className="basis-full text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </li>
  );
}

function RecentPunches({ punches }: { punches: ShownPunch[] }) {
  return (
    <section aria-labelledby="punches-heading" className="flex flex-col gap-3">
      <h2 id="punches-heading" className="text-lg font-semibold">
        Recent punches
      </h2>
      {punches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing has arrived from a reader yet. The fifty most recent punches appear here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-start">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">When</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">Who</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">Code</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">Reader</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {punches.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <time dateTime={p.punchedAt}>{p.when}</time>
                  </td>
                  <td className="px-3 py-2">
                    {p.person ?? (
                      <span className="text-muted-foreground">Nobody — no one has this code</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <bdi>{p.code}</bdi>
                  </td>
                  <td className="px-3 py-2">{p.device}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
