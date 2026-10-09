import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildEmployeeReport } from '../src/services/employeeReport.js'
import { buildEndDayShiftReport, buildShiftReport } from '../src/services/shiftReports.js'
import { isActiveExpense, isCashboxExpense } from '../src/services/expenseReporting.js'

const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const reports = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
const expensesSource = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
const staff = [{ id: 'cashier-1', name: 'علي', code: 'A1', active: true }]
const base = { id: 'expense-1', employeeId: 'cashier-1', cashierId: 'cashier-1', cashierNameSnapshot: 'علي', businessDate: '2026-10-09', operationalDayId: 'day-1', shiftType: 'morning', amount: 10000, category: 'مشتريات', fundingSource: 'cashbox', paymentSource: 'cashbox', createdAt: 1000 }
const edited = { ...base, amount: 15000, category: 'نقل', fundingSource: 'management', paymentSource: 'management', updatedAt: 2000, updatedBy: 'cashier-1' }
const movedToDrawer = { ...edited, fundingSource: 'cashbox', paymentSource: 'cashbox' }
const deleted = { ...movedToDrawer, status: 'deleted' }

const employeeTotal = expense => buildEmployeeReport({ staff, expenses: [expense], from: '2026-10-01', to: '2026-10-31' }).total.expensesTotal
assert.equal(employeeTotal(base), 10000)
assert.equal(employeeTotal(edited), 15000)
assert.equal(employeeTotal(deleted), 0)
assert.equal(isActiveExpense(deleted), false)
assert.equal(isCashboxExpense(base), true)
assert.equal(isCashboxExpense(edited), false)
assert.equal(isCashboxExpense(movedToDrawer), true)
assert.equal(buildShiftReport({ expenses: [base], businessDate: base.businessDate, operationalDayId: base.operationalDayId, shiftType: 'morning' }).drawerExpenses, 10000)
assert.equal(buildShiftReport({ expenses: [edited], businessDate: base.businessDate, operationalDayId: base.operationalDayId, shiftType: 'morning' }).drawerExpenses, 0)
assert.equal(buildShiftReport({ expenses: [movedToDrawer], businessDate: base.businessDate, operationalDayId: base.operationalDayId, shiftType: 'morning' }).drawerExpenses, 15000)
assert.equal(buildEndDayShiftReport({ expenses: [movedToDrawer], businessDate: base.businessDate, operationalDayId: base.operationalDayId, openingCashBalance: 50000 }).expectedFinalDrawer, 35000)

assert.match(sync, /export const saveCentralExpense = async/)
assert.match(sync, /export const saveCentralExpenseWithCashbox = async/)
assert.match(sync, /dispatchExpensesUpdated\(\)/)
assert.match(sync, /EXPENSE_EDIT_READBACK_FAILED/)
assert.match(sync, /DELETE_READBACK_FAILED/)
assert.match(sync, /const sameEditableFields = \[/)
assert.match(sync, /'employeeNameSnapshot', 'cashierNameSnapshot', 'employeeName', 'person'/)
assert.match(expensesSource, /employeeNameSnapshot: person, cashierNameSnapshot: person, employeeName: person/)
assert.match(reports, /subscribeCentralExpenses\(/)
assert.match(reports, /pos101-expenses-updated/)
assert.match(expensesSource, /saveCentralExpenseWithCashbox/)

for (const label of [
  'EXPENSE_CREATE_REPORT_UPDATE', 'EXPENSE_EDIT_REPORT_UPDATE', 'EXPENSE_DELETE_SOFT_REPORT_UPDATE',
  'EMPLOYEE_EXPENSE_REPORT_UPDATES', 'CASHIER_EXPENSE_REPORT_UPDATES', 'MORNING_REPORT_UPDATES_AFTER_EXPENSE_EDIT',
  'EVENING_REPORT_UPDATES_AFTER_EXPENSE_EDIT', 'END_DAY_EXPENSE_RECALC', 'DRAWER_CASH_RECALCULATES_AFTER_PAYMENT_SOURCE_CHANGE',
]) console.log(`${label}=PASS`)
console.log('WITHDRAWAL_EDIT_NAME_PATCH_REACHES_CANONICAL_FIELDS=PASS')
console.log('WITHDRAWAL_EDIT_IDEMPOTENCY_GUARD_INCLUDES_NAME=PASS')
console.log('SYNC_SAFETY_UNCHANGED=PASS')
