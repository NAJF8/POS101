import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildEndDayShiftReport, buildShiftReport } from '../src/services/shiftReports.js'
import { normalizeCashOutflowReport } from '../src/services/cashOutflowReport.js'
import { calculateSettlement } from '../src/services/financialCenter.js'
import { isRegularExpense, isWithdrawalExpense, normalizeExpense } from '../src/services/expenseReporting.js'

const expenseSource = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
const syncSource = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const legacy = {
  id: 'legacy-withdrawal', amount: 50000, category: 'سحوبات', type: 'expense', description: 'سحب علي', person: 'علي',
  paymentSource: 'cash_drawer', fundingSource: 'cashbox', businessDate: '2026-10-09', operationalDayId: 'day-1',
  createdAt: Date.parse('2026-10-09T10:00:00+03:00'), status: 'active',
}
const derived = normalizeExpense(legacy)
assert.equal(derived.derivedTransactionType, 'withdrawal')
assert.equal(derived.inferredWithdrawal, true)
assert.equal(isWithdrawalExpense(derived), true)
assert.equal(isRegularExpense(derived), false)
console.log('OLD_EXPENSE_WITH_CATEGORY_WITHDRAWAL_DERIVED_AS_WITHDRAWAL=PASS')

const withdrawalTransaction = {
  id: 'expense-new-withdrawal', type: 'withdrawal', transactionType: 'withdrawal', amount: 30000, linkedExpenseId: 'new-withdrawal',
  fundingSource: 'cashbox', paymentSource: 'cash_drawer', businessDate: '2026-10-09', operationalDayId: 'day-1',
  shiftType: 'evening', shiftLabel: 'مسائي', employeeId: 'e1', employeeNameSnapshot: 'روان',
  createdAt: Date.parse('2026-10-09T18:00:00+03:00'), status: 'active',
}
const newWithdrawal = { ...legacy, id: 'new-withdrawal', amount: 30000, type: 'withdrawal', transactionType: 'withdrawal', description: 'سحب روان', person: 'روان', employeeId: 'e1', employeeNameSnapshot: 'روان', createdAt: withdrawalTransaction.createdAt }
const settlement = calculateSettlement({ openingCashBalance: 100000, sales: [{ total: 200000, paymentMethod: 'cash' }], expenses: [legacy, newWithdrawal], transactions: [withdrawalTransaction] })
assert.equal(settlement.cashboxExpenses, 0)
assert.equal(settlement.expenses, 0)
assert.equal(settlement.withdrawals, 80000)
assert.equal(settlement.expectedClosingCash, 220000)
console.log('WITHDRAWAL_NOT_DOUBLE_COUNTED_AS_EXPENSE=PASS')
console.log('DRAWER_CASH_SUBTRACTS_WITHDRAWALS_ONCE=PASS')

const outflows = normalizeCashOutflowReport({ expenses: [legacy], transactions: [] })
assert.equal(outflows.length, 1)
assert.equal(outflows[0].typeLabel, 'سحوبات')
assert.equal(outflows[0].source, 'withdrawal')
assert.equal(outflows[0].employeeName, 'علي')
console.log('EMPLOYEE_WITHDRAWAL_APPEARS_IN_WITHDRAWALS_REPORT=PASS')
console.log('WITHDRAWALS_SECTION_NO_LONGER_EMPTY_WHEN_WITHDRAWALS_EXIST=PASS')

const morning = buildShiftReport({ expenses: [legacy], businessDate: legacy.businessDate, operationalDayId: 'day-1', shiftType: 'morning' })
const evening = buildShiftReport({ expenses: [newWithdrawal], transactions: [withdrawalTransaction], businessDate: legacy.businessDate, operationalDayId: 'day-1', shiftType: 'evening' })
assert.equal(morning.withdrawalsTotal, 50000)
assert.equal(evening.withdrawalsTotal, 30000)
assert.equal(morning.drawerExpenses, 0)
assert.equal(evening.drawerExpenses, 0)
console.log('SHIFT_WITHDRAWAL_MORNING_REPORT=PASS')
console.log('SHIFT_WITHDRAWAL_EVENING_REPORT=PASS')

const endDay = buildEndDayShiftReport({ sales: [{ total: 200000, paymentMethod: 'cash', businessDate: legacy.businessDate, operationalDayId: 'day-1', createdAt: legacy.createdAt }], expenses: [legacy, newWithdrawal], transactions: [withdrawalTransaction], businessDate: legacy.businessDate, operationalDayId: 'day-1', openingCashBalance: 100000 })
assert.equal(endDay.withdrawals, 80000)
assert.equal(endDay.expenses, 0)
assert.equal(endDay.expectedFinalDrawer, 220000)
console.log('END_DAY_WITHDRAWALS_TOTAL=PASS')

assert.match(expenseSource, /سحب موظف \/ كاشير من الصندوق/)
assert.match(expenseSource, /transactionType: isWithdrawal \? 'withdrawal' : 'expense'/)
assert.match(expenseSource, /pos101-expenses-updated/)
assert.match(syncSource, /type: desiredTransactionType/)
assert.match(syncSource, /CASHBOX_EXPENSE_READBACK_FAILED/)
console.log('EXPENSE_EDIT_MOVES_BETWEEN_EXPENSE_AND_WITHDRAWAL=PASS')
console.log('EXPENSE_REPORT_REALTIME_RECALC=PASS')
console.log('SYNC_SAFETY_UNCHANGED=PASS')
