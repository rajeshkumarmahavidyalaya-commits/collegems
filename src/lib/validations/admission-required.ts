/**
 * Which optional admission fields a college has made required (0330, 0331:
 * `admissions.required_fields`), which optional sections the admission form
 * draws (`admissions.form_panels`) and how numbers are suggested
 * (`admissions.numbering`). No imports: the admission form is a client
 * component, and the server action asks the same functions, so the two cannot
 * disagree about what "required" means. The form marks and checks; the action
 * refuses -- the action is the gate.
 */

/** Setting key → the form's field name, and how to name it in a sentence. */
export const REQUIRED_FIELDS = {
  last_name: { field: "lastName", label: "Last name" },
  date_of_birth: { field: "dateOfBirth", label: "Date of birth" },
  gender: { field: "gender", label: "Gender" },
  religion: { field: "religion", label: "Religion" },
  caste: { field: "caste", label: "Caste/Sub-caste" },
  blood_group: { field: "bloodGroup", label: "Blood group" },
  id_number: { field: "idNumber", label: "ID number" },
  student_photo: { field: "photo", label: "Student photo" },
  medical: { field: "medicalNotes", label: "Medical complaint" },
  phone: { field: "phone", label: "Phone number" },
  email: { field: "email", label: "Email" },
  address_line1: { field: "addressLine1", label: "Address" },
  city: { field: "city", label: "City" },
  state: { field: "state", label: "State" },
  country: { field: "country", label: "Country" },
  postal_code: { field: "postalCode", label: "PIN code" },
  roll_number: { field: "rollNumber", label: "Roll number" },
  medium: { field: "mediumId", label: "Medium" },
  house: { field: "houseId", label: "House" },
} as const;

export type RequiredFieldKey = keyof typeof REQUIRED_FIELDS;

/**
 * Keys that are on when a college has said nothing. Only the last name: it was
 * required before the switch existed (0331), so a college that never opened
 * the settings keeps the form it had.
 */
const ON_BY_DEFAULT: RequiredFieldKey[] = ["last_name"];

/** The switched-on keys of the setting's value; anything unrecognised is ignored. */
export function requiredFieldNames(value: unknown): string[] {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return (Object.keys(REQUIRED_FIELDS) as RequiredFieldKey[])
    .filter((k) => (typeof v[k] === "boolean" ? v[k] === true : ON_BY_DEFAULT.includes(k)))
    .map((k) => REQUIRED_FIELDS[k].field);
}

/** The setting's value as switches, with the defaults filled in (for the settings screen). */
export function requiredSwitches(value: unknown): Record<RequiredFieldKey, boolean> {
  const on = new Set(requiredFieldNames(value));
  return Object.fromEntries(
    (Object.keys(REQUIRED_FIELDS) as RequiredFieldKey[]).map((k) => [k, on.has(REQUIRED_FIELDS[k].field)]),
  ) as Record<RequiredFieldKey, boolean>;
}

/** Field errors for every required field left empty. */
export function missingRequired(values: Record<string, unknown>, required: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(REQUIRED_FIELDS) as RequiredFieldKey[]) {
    const { field, label } = REQUIRED_FIELDS[key];
    if (!required.includes(field)) continue;
    const v = values[field];
    if (v === undefined || v === null || v === false || (typeof v === "string" && v.trim() === "")) {
      out[field] = [`${label} is required`];
    }
  }
  return out;
}

/** The optional sections of the admission form (0331), with their defaults. */
export const FORM_PANELS = {
  parent_details: { label: "Parent Details Panel", default: false },
  parent_login: { label: "Parent Login Panel", default: false },
  student_login: { label: "Student Login Panel", default: false },
  transport: { label: "Transport Details", default: true },
  fees: { label: "Fees Panel", default: false },
  survey: { label: "Survey Panel", default: false },
} as const;

export type FormPanel = keyof typeof FORM_PANELS;
export type FormPanels = Record<FormPanel, boolean>;

export function formPanels(value: unknown): FormPanels {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    (Object.keys(FORM_PANELS) as FormPanel[]).map((k) => [k, typeof v[k] === "boolean" ? v[k] : FORM_PANELS[k].default]),
  ) as FormPanels;
}

export type Numbering = { autoAdmissionNumber: boolean; admissionPrefix: string; autoRollNumber: boolean };

export function numbering(value: unknown): Numbering {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    autoAdmissionNumber: v.auto_admission_number === true,
    admissionPrefix: typeof v.admission_prefix === "string" ? v.admission_prefix : "",
    autoRollNumber: v.auto_roll_number === true,
  };
}

/** The survey panel's answers: how the family heard of the college. */
export const HEARD_FROM = [
  "Newspaper",
  "Hoarding or banner",
  "Social media",
  "Website",
  "Friend or relative",
  "Current or former student",
  "School visit or camp",
  "Other",
] as const;
