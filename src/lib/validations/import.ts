import { z } from "zod";
export { splitCsvLine, parseImportDate, normaliseGender } from "./csv";

/**
 * Bulk student import.
 *
 * Rule 13 in full: the preview is **editable rows**, and apply writes what the
 * rows say rather than re-parsing the file. Rule 7's bound is 500 rows a run,
 * stated in the database and repeated here so the browser refuses a 4,000-row
 * file before uploading it rather than after.
 *
 * Parsing lives here rather than in Postgres because a CSV is a browser
 * problem — quoted commas, a UTF-8 BOM, Excel's date formats. *Judging* the
 * parsed rows lives in Postgres (`import_validate_run`), because that needs the
 * school's own data to check against.
 */
export { MAX_IMPORT_ROWS, IMPORT_COLUMNS, parseCsv, applySentence, rowStatus } from "./import-display";
export type { ImportField, ParsedRow, ParseResult } from "./import-display";

export const importRowEditSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().max(80).optional(),
  middleName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  admissionNumber: z.string().max(40).optional(),
  dateOfBirth: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"), z.literal("")])
    .optional(),
  gender: z.string().max(20).optional(),
  sectionId: z.union([z.string().uuid(), z.literal("")]).optional(),
  rollNumber: z.string().max(20).optional(),
  guardianName: z.string().max(120).optional(),
  guardianPhone: z.string().max(30).optional(),
  skipped: z.boolean().optional(),
});

export type ImportRowEdit = z.infer<typeof importRowEditSchema>;

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
