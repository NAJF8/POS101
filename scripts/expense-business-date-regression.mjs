import assert from 'node:assert/strict'
import {
  getExpensesForBusinessDate,
  normalizeExpense,
  normalizeTimestamp,
  resolveExpenseBusinessDate,
  sumExpenses,
} from '../src/services/expenseReporting.js'

const rows = [
  { id: 'A', amount: 1000, businessDate: '2026-10-02', createdAt: '2026-10-02T20:00:00+03:00' },
  { id: 'B', amount: '5000', businessDate: '2026-10-02', createdAt: '2026-10-03T00:30:00+03:00' },
  { id: 'C', amount: 250, date: '2026-10-02T10:00:00+03:00' },
  { id: 'D', amount: 300, timestamp: Math.floor(Date.parse('2026-10-02T12:00:00+03:00') / 1000) },
  { id: 'E', amount: 400, timestamp: Date.parse('2026-10-02T13:00:00+03:00') },
  { id: 'F', amount: 50, createdAt: '2026-10-01T21:30:00.000Z' },
  { id: 'G', amount: 75, operationalDayId: 'DAY-02', createdAt: '2026-10-04T00:00:00+03:00' },
]

assert.equal(resolveExpenseBusinessDate(rows[0]), '2026-10-02')
assert.equal(resolveExpenseBusinessDate(rows[1]), '2026-10-02')
assert.equal(resolveExpenseBusinessDate(rows[6], { operationalDayDates: { 'DAY-02': '2026-10-02' } }), '2026-10-02')
assert.equal(normalizeTimestamp(1_790_942_400), 1_790_942_400_000)
assert.equal(normalizeTimestamp(1_790_942_400_000), 1_790_942_400_000)
assert.deepEqual(getExpensesForBusinessDate(rows, '2026-10-02').map(row => row.id), ['A', 'B', 'C', 'D', 'E', 'F'])
assert.deepEqual(getExpensesForBusinessDate(rows, '2026-10-03'), [])
assert.equal(sumExpenses(getExpensesForBusinessDate(rows, '2026-10-02')), 7000)
assert.equal(normalizeExpense({ amount: '5000', description: 'test' }).amount, 5000)
console.log('EXPENSE_BUSINESS_DATE_REGRESSION=PASS')
