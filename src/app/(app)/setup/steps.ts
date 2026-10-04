import { CircleCheck, IndianRupee, Laptop, NotebookText, UserPlus, Users, Wand2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** The reference wizard's seven steps, in its order, with its words. */
export const WIZARD_STEPS = [
  { key: "welcome", title: "Welcome", subtitle: "Welcome to the School Setup Wizard", icon: Wand2, required: false },
  { key: "classes", title: "Assign Classes", subtitle: "Select and assign classes for your school", icon: Laptop, required: true },
  { key: "subjects", title: "Add Subjects", subtitle: "Configure subjects for your classes", icon: NotebookText, required: true },
  { key: "student_types", title: "Student Types", subtitle: "Define different student types", icon: Users, required: true },
  { key: "fee_types", title: "Fee Types", subtitle: "Set up fee structures and types", icon: IndianRupee, required: true },
  { key: "registration_settings", title: "Registration Settings", subtitle: "Set up student registration options", icon: UserPlus, required: false },
  { key: "complete", title: "Extras", subtitle: "Setup wizard completed successfully", icon: CircleCheck, required: false },
] as const satisfies readonly { key: string; title: string; subtitle: string; icon: LucideIcon; required: boolean }[];

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"];
