import Link from "next/link";
import { ArrowRight, ReceiptText, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getUserContext } from "@/lib/auth/context";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { listMyFamilyAccounts } from "../actions";

export const metadata = { title: "Fees" };

/**
 * The family's side of the fee module, and the door that was missing.
 *
 * Everything this page shows was already readable. A parent holds `fees.view`;
 * `fees_student_balances()` is row-scoped to their own children by RLS;
 * `/fees/students/[id]` renders the whole account and its "Collect payment"
 * controls are gated on `fees.collect`, which a family does not hold, so it was
 * already read-only for them. `dashboard_summary()` even puts the total on the
 * home page. There was simply no link, anywhere, from that number to what it is
 * made of — nine fee screens in the product and the menu offered a family none
 * of them.
 *
 * So this adds no new read path and no new permission (rule 11: do not add a
 * screen to answer a question that already has one). It is a chooser: whose
 * account, and then the account page the office uses.
 */
export default async function FamilyFeesPage() {
  const [ctx, t, locale] = await Promise.all([getUserContext(), getT(), getLocale()]);
  const accounts = await listMyFamilyAccounts();

  // Not a permission check — `listMyFamilyAccounts` is already narrowed to the
  // relationship, and a member of staff gets `[]` from it whatever they may
  // read. This is so the empty screen says the right sentence: a bursar landing
  // here has not run out of children, they are on the wrong screen.
  const isFamily = ctx?.roleCode === "parent" || ctx?.roleCode === "student";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("family.fees.title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("family.fees.body")}</p>
      </div>

      {!isFamily ? (
        <EmptyState
          icon={<Users className="size-6 text-muted-foreground" aria-hidden="true" />}
          title={t("family.fees.staff.title")}
          body={t("family.fees.staff.body")}
        />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6 text-muted-foreground" aria-hidden="true" />}
          title={t("family.fees.noChildren.title")}
          body={t("family.fees.noChildren.body")}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {accounts.map((account) => {
            // Three states, not a nullable number, for the same reason the
            // dashboard draws the distinction: "nothing has been billed" and
            // "billed and settled" look identical as a zero and mean opposite
            // things to a family deciding whether to worry.
            const state =
              account.charged === 0
                ? ("unbilled" as const)
                : account.balance > 0
                  ? ("owing" as const)
                  : account.balance < 0
                    ? ("credit" as const)
                    : ("settled" as const);

            return (
              <li key={account.studentId}>
                <Link
                  href={`/fees/students/${account.studentId}`}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 transition-colors duration-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{account.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {[account.sectionLabel, account.admissionNumber]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {state === "unbilled" ? (
                      <span className="text-sm text-muted-foreground">
                        {t("family.fees.nothingBilled")}
                      </span>
                    ) : (
                      <div className="text-end">
                        <p className="font-mono text-lg tabular-nums">
                          {formatCurrency(Math.abs(account.balance), locale)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {account.lastPaymentAt
                            ? t("family.fees.lastPayment", {
                                date: formatDate(account.lastPaymentAt, locale),
                              })
                            : t("family.fees.noPaymentYet")}
                        </p>
                      </div>
                    )}

                    {/* Never colour alone: the badge carries the word. */}
                    <Badge
                      variant={
                        state === "owing"
                          ? "destructive"
                          : state === "credit"
                            ? "secondary"
                            : "default"
                      }
                    >
                      {state === "owing"
                        ? t("family.fees.owing")
                        : state === "credit"
                          ? t("family.fees.inCredit")
                          : state === "settled"
                            ? t("family.fees.settled")
                            : t("family.fees.notBilled")}
                    </Badge>

                    <ArrowRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {isFamily && accounts.length > 0 ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <ReceiptText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t("family.fees.footnote")}</span>
        </p>
      ) : null}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
      {icon}
      <h2 className="font-medium">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
