/**
 * Which optional admission fields a college has made required (0330,
 * `admissions.required_fields`). No imports: the admission form is a client
 * component, and the server action asks the same function, so the two cannot
 * disagree about what "required" means. The form marks and checks; the action
 * refuses -- the action is the gate.
 */

/** Setting key → the form's field name, and how to name it in a sentence. */
export const REQUIRED_FIELDS = {
  date_of_birth: { field: "dateOfBirth", label: "Date of birth" },
  gender: { field: "gender", label: "Gender" },
  blood_group: { field: "bloodGroup", label: "Blood group" },
  phone: { field: "phone", label: "Phone number" },
  email: { field: "email", label: "Email" },
  address_line1: { field: "addressLine1", label: "Address" },
  city: { field: "city", label: "City" },
  state: { field: "state", label: "State" },
  postal_code: { field: "postalCode", label: "PIN code" },
  roll_number: { field: "rollNumber", label: "Roll number" },
  medium: { field: "mediumId", label: "Medium" },
  house: { field: "houseId", label: "House" },
} as const;

export type RequiredFieldKey = keyof typeof REQUIRED_FIELDS;

/** The switched-on keys of the setting's value; anything unrecognised is ignored. */
export function requiredFieldNames(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const v = value as Record<string, unknown>;
  return (Object.keys(REQUIRED_FIELDS) as RequiredFieldKey[])
    .filter((k) => v[k] === true)
    .map((k) => REQUIRED_FIELDS[k].field);
}

/** Field errors for every required field left empty. */
export function missingRequired(values: Record<string, unknown>, required: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(REQUIRED_FIELDS) as RequiredFieldKey[]) {
    const { field, label } = REQUIRED_FIELDS[key];
    if (!required.includes(field)) continue;
    const v = values[field];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      out[field] = [`${label} is required`];
    }
  }
  return out;
}
