const amount = value => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

// The comprehensive report receives already-filtered rows. Keeping this pure
// makes the screen, browser print, direct print payload, and fixture tests use
// the same financial contract without reading localStorage again.
export const calculateComprehensiveSummary = (sales = [], expenses = []) => {
  const grossSales = sales.reduce((sum, sale) => sum + amount(sale.subtotal ?? sale.total), 0)
  const discounts = sales.reduce((sum, sale) => sum + amount(sale.discount), 0)
  const expensesTotal = expenses.reduce((sum, expense) => sum + amount(expense.amount), 0)
  const netAfterDiscount = grossSales - discounts
  const netAfterExpenses = grossSales - expensesTotal
  const netAfterExpensesAndDiscount = grossSales - expensesTotal - discounts

  return {
    grossSales,
    discounts,
    expenses: expensesTotal,
    netAfterDiscount,
    netAfterExpenses,
    netAfterExpensesAndDiscount,
  }
}
