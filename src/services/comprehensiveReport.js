import { sumExpenses } from './expenseReporting.js'
import { calculateSettlement } from './financialCenter.js'

const amount = value => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

// The comprehensive report receives already-filtered rows. Keeping this pure
// makes the screen, browser print, direct print payload, and fixture tests use
// the same financial contract without reading localStorage again.
export const calculateComprehensiveSummary = (sales = [], expenses = [], transactions = []) => {
  const grossSales = sales.reduce((sum, sale) => sum + amount(sale.subtotal ?? sale.total), 0)
  const discounts = sales.reduce((sum, sale) => sum + amount(sale.discount), 0)
  const electronicSales = sales.reduce((sum, sale) => {
    const method = sale.paymentMethod || sale.payment?.method
    return sum + (method === 'electronic' ? amount(sale.total) : 0)
  }, 0)
  const expensesTotal = sumExpenses(expenses)
  const netAfterDiscount = grossSales - discounts
  const netAfterExpenses = grossSales - expensesTotal
  const netAfterExpensesAndDiscount = grossSales - expensesTotal - discounts
  const financial = calculateSettlement({ sales, expenses, transactions })
  const netCashAfterAll = financial.expectedCash

  return {
    grossSales,
    discounts,
    expenses: expensesTotal,
    electronicSales,
    netAfterDiscount,
    netAfterExpenses,
    netAfterExpensesAndDiscount,
    netCashAfterAll,
    cashSales: financial.cashSales,
    cashboxWithdrawals: financial.cashboxWithdrawals,
    managementWithdrawals: financial.managementWithdrawals,
    withdrawals: financial.withdrawals,
    deposits: financial.deposits,
    finalAfterAllSettlements: financial.finalAfterAllSettlements,
    orderCount: financial.orderCount,
  }
}
