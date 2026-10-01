/**
 * The text of an uploaded roll: a CSV as it is, or an Excel workbook's first
 * sheet converted to CSV. The Excel reader is imported only when an Excel file
 * is chosen, so the import screen does not carry it for a CSV upload.
 *
 * The old binary `.xls` format is refused in a sentence rather than guessed
 * at: it is a different file format entirely, and every version of Excel can
 * save the same sheet as `.xlsx`.
 */
export async function readRollFile(file: File): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls")) {
    return { ok: false, error: "That is an old-style Excel file (.xls). Open it in Excel and save it as .xlsx or .csv, then upload that." };
  }
  if (name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    try {
      const { xlsxToCsv } = await import("./xlsx");
      return { ok: true, text: xlsxToCsv(new Uint8Array(await file.arrayBuffer())) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "That workbook could not be read." };
    }
  }
  return { ok: true, text: await file.text() };
}

/** What the file input offers: CSV and Excel. */
export const ROLL_FILE_ACCEPT =
  ".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
