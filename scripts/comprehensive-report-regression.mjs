import assert from 'node:assert/strict'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'

const first = calculateComprehensiveSummary(
  [{ subtotal: 1_000_000, discount: 50_000, total: 950_000 }],
  [{ amount: 200_000 }],
)
assert.deepEqual(first, {
  grossSales: 1_000_000,
  discounts: 50_000,
  expenses: 200_000,
  electronicSales: 0,
  netAfterDiscount: 950_000,
  netAfterExpenses: 800_000,
  netAfterExpensesAndDiscount: 750_000,
  netCashAfterAll: 750_000,
})

const electronicFixture = calculateComprehensiveSummary(
  [
    { subtotal: 850_000, total: 850_000, discount: 25_000, paymentMethod: 'cash' },
    { subtotal: 150_000, total: 150_000, discount: 25_000, paymentMethod: 'electronic' },
  ],
  [{ amount: 200_000 }],
)
assert.equal(electronicFixture.grossSales, 1_000_000)
assert.equal(electronicFixture.electronicSales, 150_000)
assert.equal(electronicFixture.netAfterDiscount, 950_000)
assert.equal(electronicFixture.netAfterExpenses, 800_000)
assert.equal(electronicFixture.netAfterExpensesAndDiscount, 750_000)
assert.equal(electronicFixture.netCashAfterAll, 600_000)

const second = calculateComprehensiveSummary(
  [{ subtotal: 141_000, discount: 0, total: 141_000 }],
  [{ amount: 0 }],
)
assert.equal(second.netAfterDiscount, 141_000)
assert.equal(second.netAfterExpenses, 141_000)
assert.equal(second.netAfterExpensesAndDiscount, 141_000)
assert.equal(second.netCashAfterAll, 141_000)

console.log('COMPREHENSIVE_REPORT_REGRESSION=PASS')
