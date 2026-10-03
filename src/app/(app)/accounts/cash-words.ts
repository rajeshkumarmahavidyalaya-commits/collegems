/**
 * The reference's words for Expenses and Donation, in one place. A plain
 * module rather than an export of the client form: a Server Component that
 * imports a value from a "use client" file receives a reference, not the value.
 */
export const CASH_WORDS = {
  expense: {
    list: "Expenses",
    listHref: "/accounts/expenses",
    one: "expense",
    many: "expenses",
    add: "Add New Expense",
    party: "Supplier Name",
    date: "Expense Date",
    via: "Paid from",
    categories: "Expense Categories",
    addCategory: "Add Expense Category",
    viewAll: "View Expenses",
  },
  income: {
    list: "Donation",
    listHref: "/accounts/donations",
    one: "donation",
    many: "donations",
    add: "Add New Donation",
    party: "Doner Name",
    date: "Donation Date",
    via: "Received into",
    categories: "Donation Categories",
    addCategory: "Add Donation Category",
    viewAll: "View Donation",
  },
} as const;
