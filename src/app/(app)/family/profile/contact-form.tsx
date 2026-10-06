"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateChildContact, updateMyContact, type ContactDetails } from "../actions";

/**
 * A family corrects the child's phone and address. The name and the email are
 * shown, not edited: the name is the college's record, and the email is what
 * a login is matched by. `family_update_contact` enforces both.
 */
export function ChildContactForm({ studentId, initial }: { studentId: string; initial: ContactDetails }) {
  const [values, setValues] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof ContactDetails) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await updateChildContact(studentId, {
        phone: values.phone.trim(),
        addressLine1: values.addressLine1.trim(),
        addressLine2: values.addressLine2.trim(),
        city: values.city.trim(),
        state: values.state.trim(),
        postalCode: values.postalCode.trim(),
        country: values.country.trim(),
      });
      if (!r.ok) return setError(r.error);
      toast.success("The contact details are saved.");
    });
  }

  const field = (k: keyof ContactDetails, label: string, extra?: Partial<React.ComponentProps<typeof Input>>) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`contact-${k}`}>{label}</Label>
      <Input id={`contact-${k}`} value={values[k]} onChange={set(k)} {...extra} />
    </div>
  );

  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
      {field("phone", "Phone", { type: "tel", maxLength: 20, autoComplete: "tel" })}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-email">Email</Label>
        <Input id="contact-email" value={values.email} readOnly aria-describedby="contact-email-hint" />
        <p id="contact-email-hint" className="text-xs text-muted-foreground">
          The college changes an email address, because a login is matched by it.
        </p>
      </div>
      {field("addressLine1", "Address", { maxLength: 200, autoComplete: "address-line1" })}
      {field("addressLine2", "Address line 2", { maxLength: 200, autoComplete: "address-line2" })}
      {field("city", "City", { maxLength: 100, autoComplete: "address-level2" })}
      {field("state", "State", { maxLength: 100, autoComplete: "address-level1" })}
      {field("postalCode", "PIN code", { maxLength: 20, autoComplete: "postal-code" })}
      {field("country", "Country", { maxLength: 100, autoComplete: "country-name" })}
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Save Settings
        </Button>
      </div>
    </form>
  );
}

/** A parent's own phone and occupation, on their guardian record. */
export function MyContactForm({ initial }: { initial: { phone: string; occupation: string } }) {
  const [values, setValues] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await updateMyContact({ phone: values.phone.trim(), occupation: values.occupation.trim() });
      if (!r.ok) return setError(r.error);
      toast.success("Your details are saved.");
    });
  }

  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="my-phone">Your phone</Label>
        <Input
          id="my-phone"
          type="tel"
          maxLength={20}
          autoComplete="tel"
          value={values.phone}
          onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="my-occupation">Occupation</Label>
        <Input
          id="my-occupation"
          maxLength={100}
          value={values.occupation}
          onChange={(e) => setValues((v) => ({ ...v, occupation: e.target.value }))}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Save my details
        </Button>
      </div>
    </form>
  );
}
