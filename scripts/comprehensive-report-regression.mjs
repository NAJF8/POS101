import assert from 'node:assert/strict'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'

const first = calculateComprehensiveSummary(
  [{ subtotal: 1_000_000, discount: 50_000, total: 950_000, paymentMethod: 'cash' }],
  [{ amount: 200_000 }],
)
assert.deepEqual({ grossSales: first.grossSales, discounts: first.discounts, expenses: first.expenses, netCashAfterAll: first.netCashAfterAll, finalAfterAllSettlements: first.finalAfterAllSettlements }, { grossSales: 1_000_000, discounts: 50_000, expenses: 200_000, netCashAfterAll: 750_000, finalAfterAllSettlements: 750_000 })

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
assert.equal(electronicFixture.netCashAfterAll, 650_000)

const second = calculateComprehensiveSummary(
  [{ subtotal: 141_000, discount: 0, total: 141_000, paymentMethod: 'cash' }],
  [{ amount: 0 }],
)
assert.equal(second.netAfterDiscount, 141_000)
assert.equal(second.netAfterExpenses, 141_000)
assert.equal(second.netAfterExpensesAndDiscount, 141_000)
assert.equal(second.netCashAfterAll, 141_000)

console.log('COMPREHENSIVE_REPORT_REGRESSION=PASS')
console.log('REPORT_FINAL_AFTER_ALL=PASS')
