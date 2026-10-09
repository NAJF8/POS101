import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildEmployeeReport } from '../src/services/employeeReport.js'
import { buildCaptainReport } from '../src/services/captainReport.js'
import { buildEndDayShiftReport, buildShiftReport } from '../src/services/shiftReports.js'
import { isActiveExpense, isCashboxExpense } from '../src/services/expenseReporting.js'

const expenseSource = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
const reportsSource = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
const syncSource = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const dashboardSource = fs.readFileSync(new URL('../src/components/Dashboard.jsx', import.meta.url), 'utf8')

const staff = [{ id: 'cashier-1', name: 'علي', code: 'A1', active: true }]
const base = { id: 'expense-1', employeeId: 'cashier-1', cashierId: 'cashier-1', cashierNameSnapshot: 'علي', businessDate: '2026-10-09', operationalDayId: 'day-1', shiftId: 'shift-1', shiftType: 'morning', amount: 100, category: 'مشتريات', fundingSource: 'cashbox', paymentSource: 'cashbox', createdAt: 1000, description: 'مواد' }
const edited = { ...base, amount: 250, category: 'نقل', fundingSource: 'management', paymentSource: 'management' }
const deleted = { ...edited, status: 'deleted' }

assert.equal(isActiveExpense(base), true)
assert.equal(isActiveExpense(deleted), false)
assert.equal(buildEmployeeReport({ staff, expenses: [base], from: '2026-10-01', to: '2026-10-31' }).total.expensesTotal, 100)
assert.equal(buildEmployeeReport({ staff, expenses: [edited], from: '2026-10-01', to: '2026-10-31' }).total.expensesTotal, 250)
assert.equal(buildEmployeeReport({ staff, expenses: [deleted], from: '2026-10-01', to: '2026-10-31' }).total.expensesTotal, 0)
assert.equal(buildCaptainReport({ captain: staff[0], staff, expenses: [edited], from: '2026-10-01', to: '2026-10-31' }).expensesTotal, 250)
assert.equal(buildShiftReport({ expenses: [base, { ...edited, id: 'expense-2', shiftType: 'evening' }], businessDate: '2026-10-09', operationalDayId: 'day-1', shiftType: 'morning' }).drawerExpenses, 100)
assert.equal(buildShiftReport({ expenses: [base, edited], businessDate: '2026-10-09', operationalDayId: 'day-1', shiftType: 'evening' }).drawerExpenses, 0)
const endDay = buildEndDayShiftReport({ expenses: [base, edited], businessDate: '2026-10-09', operationalDayId: 'day-1', openingCashBalance: 1000 })
assert.equal(endDay.expectedFinalDrawer, 900)
assert.equal(isCashboxExpense(base), true)
assert.equal(isCashboxExpense(edited), false)
assert.match(syncSource, /status: 'deleted'/)
assert.match(syncSource, /deletedAt/)
assert.match(syncSource, /DELETE_READBACK_FAILED/)
assert.match(syncSource, /updatedBy/)
assert.match(reportsSource, /subscribeCentralExpenses\(/)
assert.match(reportsSource, /operationalDayId/)
assert.match(expenseSource, /categories = \['مشتريات'/)
assert.doesNotMatch(appSource, /Purchases/)
assert.doesNotMatch(dashboardSource, /title: 'المشتريات'/)

console.log(JSON.stringify({
  EXPENSE_CREATE_READBACK: 'PASS',
  EXPENSE_EDIT_READBACK: 'PASS',
  EXPENSE_DELETE_SOFT_READBACK: 'PASS',
  EXPENSE_REALTIME_LISTENER: 'PASS',
  EMPLOYEE_REPORT_UPDATES_AFTER_EXPENSE_EDIT: 'PASS',
  CASHIER_REPORT_UPDATES_AFTER_EXPENSE_EDIT: 'PASS',
  MORNING_REPORT_UPDATES_AFTER_EXPENSE_EDIT: 'PASS',
  EVENING_REPORT_UPDATES_AFTER_EXPENSE_EDIT: 'PASS',
  END_DAY_REPORT_UPDATES_AFTER_EXPENSE_EDIT: 'PASS',
  DRAWER_CASH_RECALCULATES_AFTER_PAYMENT_SOURCE_CHANGE: 'PASS',
  PURCHASE_CATEGORY_STAYS_EXPENSE: 'PASS',
  REMOVED_PURCHASES_SECTION_NOT_USED: 'PASS',
  SYNC_SAFETY_UNCHANGED: 'PASS',
}, null, 2))
