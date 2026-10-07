import assert from 'node:assert/strict'
import { calculateSettlement } from '../src/services/financialCenter.js'
import { normalizeExpense } from '../src/services/expenseReporting.js'

const expenses = [
  { id: 'cash', amount: 20000, businessDate: '2026-10-07', fundingSource: 'cashbox' },
  { id: 'management', amount: 30000, businessDate: '2026-10-07', fundingSource: 'management' },
  { id: 'legacy', amount: 1000, businessDate: '2026-10-07' },
]
const transactions = [
  { id: 'cash-withdrawal', type: 'withdrawal', amount: 10000, businessDate: '2026-10-07', fundingSource: 'cashbox' },
  { id: 'management-withdrawal', type: 'withdrawal', amount: 15000, businessDate: '2026-10-07', fundingSource: 'management' },
  { id: 'deposit', type: 'deposit', amount: 5000, businessDate: '2026-10-07' },
]
const normalizedLegacy = normalizeExpense(expenses[2])
assert.equal(normalizedLegacy.fundingSource, 'cashbox')
const settlement = calculateSettlement({ sales: [{ total: 100000, paymentMethod: 'cash' }], expenses, transactions })
assert.equal(settlement.cashboxExpenses, 21000)
assert.equal(settlement.managementExpenses, 30000)
assert.equal(settlement.expectedCash, 74000)
const fixture = calculateSettlement({ openingCashBalance: 86000, sales: [{ total: 100000, paymentMethod: 'cash' }], expenses: [{ amount: 20000, fundingSource: 'cashbox' }, { amount: 30000, fundingSource: 'management' }], transactions: [{ type: 'withdrawal', amount: 10000, fundingSource: 'cashbox' }, { type: 'withdrawal', amount: 15000, fundingSource: 'management' }, { type: 'deposit', amount: 5000 }] })
assert.equal(fixture.expectedCash, 161000)
assert.equal(fixture.managementExpenses + fixture.managementWithdrawals, 45000)
console.log(JSON.stringify({ EXPENSE_FUNDING_SOURCE_MODEL: 'PASS', LEGACY_EXPENSE_DEFAULT: 'cashbox', CASHBOX_EXPENSE_EFFECT: 'PASS', MANAGEMENT_EXPENSE_EFFECT: 0, EXPECTED_CLOSING_EXCLUDES_MANAGEMENT_EXPENSES: 'PASS' }))
