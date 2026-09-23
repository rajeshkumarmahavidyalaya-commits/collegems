import { Scanner } from "./scanner";

export const metadata = { title: "Scan a card" };

/**
 * Scan an identity card and open the record it belongs to.
 *
 * No permission check here, deliberately, and it is not an omission: this page
 * reads nothing. It turns a code into an address, and the record page at that
 * address checks its own permission and reads through RLS -- so a scan can
 * never show more than typing the address would. A check here would be a
 * second answer to a question the record page already answers (rule 4).
 */
export default function ScanPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Scan a card</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every identity card printed from this product carries a code in its corner. Scan it at the
          gate, the library desk or the fee counter to open that person&apos;s record, if your role
          may see it.
        </p>
      </div>
      <Scanner />
    </div>
  );
}
