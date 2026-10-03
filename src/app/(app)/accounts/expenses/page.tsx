import { CashListPage } from "../cash-book-pages";

export const metadata = { title: "Expenses" };

export default function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  return <CashListPage kind="expense" searchParams={searchParams} />;
}
