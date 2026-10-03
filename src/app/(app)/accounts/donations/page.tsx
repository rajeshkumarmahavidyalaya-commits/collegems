import { CashListPage } from "../cash-book-pages";

export const metadata = { title: "Donation" };

export default function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  return <CashListPage kind="income" searchParams={searchParams} />;
}
