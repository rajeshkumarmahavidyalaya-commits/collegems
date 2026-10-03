import { CashCategoriesPage } from "../../cash-book-pages";

export const metadata = { title: "Expense Categories" };

export default function Page() {
  return <CashCategoriesPage kind="expense" />;
}
