import assert from 'node:assert/strict'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'

const first = calculateComprehensiveSummary(
  [{ subtotal: 1_000_000, discount: 50_000, total: 950_000 }],
  [{ amount: 200_000 }],
)
assert.deepEqual(first, {
  grossSales: 1_000_000,
  discounts: 50_000,
  netIncomeAfterDiscount: 950_000,
  expenses: 200_000,
  netIncomingWithoutExpensesAndDiscount: 1_000_000,
  netIncomingAfterExpensesAndDiscount: 750_000,
})

const second = calculateComprehensiveSummary(
  [{ subtotal: 500_000, discount: 0, total: 500_000 }],
  [],
)
assert.equal(second.netIncomeAfterDiscount, 500_000)
assert.equal(second.netIncomingWithoutExpensesAndDiscount, 500_000)
assert.equal(second.netIncomingAfterExpensesAndDiscount, 500_000)

console.log('COMPREHENSIVE_REPORT_REGRESSION=PASS')
