import { z } from "zod";
import { BIOMETRIC_CODE_PATTERN } from "./biometric-display";

export const deviceNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the reader a name, such as “Main gate”.")
    .max(80, "At most 80 characters."),
});

export const staffCodeSchema = z.object({
  staffId: z.string().uuid(),
  // Empty clears the code: somebody taken off the reader is a real change.
  code: z
    .string()
    .trim()
    .refine((v) => v === "" || BIOMETRIC_CODE_PATTERN.test(v), {
      message: "Letters, digits, - and _ only, up to 32 characters.",
    }),
});
