import { CashNewPage } from "../../cash-book-pages";

export const metadata = { title: "Add New Expense" };

export default function Page() {
  return <CashNewPage kind="expense" />;
}
