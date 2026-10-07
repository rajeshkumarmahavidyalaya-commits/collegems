/** Which bills a bulk print takes. A plain module, so the server page and the client controls share one list. */
export const PRINT_STATUSES = ["unpaid", "paid", "issued", "cancelled", "all"] as const;
export type PrintStatus = (typeof PRINT_STATUSES)[number];

export const PRINT_STATUS_TEXT: Record<PrintStatus, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  issued: "Issued (paid or not)",
  cancelled: "Cancelled",
  all: "All",
};
