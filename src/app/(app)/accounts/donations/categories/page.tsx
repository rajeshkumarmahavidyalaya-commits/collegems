import { CashCategoriesPage } from "../../cash-book-pages";

export const metadata = { title: "Donation Categories" };

export default function Page() {
  return <CashCategoriesPage kind="income" />;
}
