import { CashNewPage } from "../../cash-book-pages";

export const metadata = { title: "Add New Donation" };

export default function Page() {
  return <CashNewPage kind="income" />;
}
