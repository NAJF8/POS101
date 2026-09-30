const amount = value => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

export const filterSalesByOperationalDay = (sales = [], operationalDayId) =>
  (Array.isArray(sales) ? sales : []).filter(sale => sale?.operationalDayId === operationalDayId && !sale?.voided)

export const filterExpensesByOperationalDay = (expenses = [], operationalDayId) =>
  (Array.isArray(expenses) ? expenses : []).filter(expense => expense?.operationalDayId === operationalDayId)

export const calculateOperationalDaySummary = (sales = [], expenses = [], operationalDayId) => {
  const daySales = filterSalesByOperationalDay(sales, operationalDayId)
  const dayExpenses = filterExpensesByOperationalDay(expenses, operationalDayId)
  const total = daySales.reduce((sum, sale) => sum + amount(sale.total), 0)
  const discount = daySales.reduce((sum, sale) => sum + amount(sale.discount), 0)
  const expensesTotal = dayExpenses.reduce((sum, expense) => sum + amount(expense.amount), 0)
  const cash = daySales.reduce((sum, sale) => sum + (sale.paymentMethod === 'cash' ? amount(sale.total) : 0), 0)
  const electronic = daySales.reduce((sum, sale) => sum + (sale.paymentMethod === 'electronic' ? amount(sale.total) : 0), 0)
  return {
    count: daySales.length,
    total,
    discount,
    expenses: expensesTotal,
    cash,
    electronic,
    net: total - expensesTotal,
    netAfterDiscountAndExpenses: total - discount - expensesTotal,
  }
}
