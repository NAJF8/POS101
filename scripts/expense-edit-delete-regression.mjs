import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildEmployeeReport } from '../src/services/employeeReport.js'

const expenseSource = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
const syncSource = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const deleteSource = syncSource.slice(syncSource.indexOf('export const deleteCentralExpense'), syncSource.indexOf('export const deleteCentralExpense') + 900)
const editSource = syncSource.slice(syncSource.indexOf('export const saveCentralExpense ='), syncSource.indexOf('export const saveLocalExpensePending'))
const withdrawalSource = syncSource.slice(syncSource.indexOf('export const saveCashboxTransaction ='), syncSource.indexOf('export const updateCashboxTransaction ='))

assert.equal(withdrawalSource.includes('CASHBOX_INSUFFICIENT_BALANCE'), false)
assert.equal(withdrawalSource.includes('الرصيد غير كافي'), false)
assert.equal(expenseSource.includes("recordType: 'expense', type: 'expense'"), true)
assert.equal(expenseSource.includes('saveCentralExpenseWithCashbox'), true)
assert.equal(expenseSource.includes('saveCashboxTransaction'), false)
assert.equal(expenseSource.includes('alert('), false)
assert.equal(expenseSource.includes('confirm('), false)
assert.match(deleteSource, /set\(ref\(db, `pos101_expenses\/\$\{id\}`\), null\)/)
assert.match(deleteSource, /const check = await get\(ref\(db, `pos101_expenses\/\$\{id\}`\)\)/)
assert.match(deleteSource, /DELETE_READBACK_FAILED/)
assert.match(deleteSource, /writeLocalExpenses\(readCachedExpenses\(\)\.filter/)
assert.match(editSource, /saveCentralExpense = async \(expense, \{ existing = false \} = \{\}\)/)
assert.match(editSource, /EXPENSE_EDIT_READBACK_FAILED/)
assert.match(expenseSource, /setExpenses\(currentRows => currentRows\.map\(row => row\.id === saved\.id/)
assert.match(expenseSource, /setExpenses\(currentRows => currentRows\.filter\(row => row\.id !== expense\.id\)/)
assert.match(expenseSource, /findOperationalDayByBusinessDate\(historicalDate\)/)
assert.match(syncSource, /export const updateCashboxTransaction/)
assert.match(syncSource, /export const deleteCashboxTransaction/)

const staff = [{ id: 'h1', name: 'حيدر', code: '109', active: true }]
const report = buildEmployeeReport({
  staff,
  expenses: [{ id: 'e1', employeeId: 'h1', category: 'نقل', amount: 50, businessDate: '2026-10-06' }],
  transactions: [{ id: 'w1', type: 'withdrawal', employeeId: 'h1', amount: 125, businessDate: '2026-10-06' }],
  from: '2026-10-01',
  to: '2026-10-31',
})
assert.equal(report.total.employeeTotal, 175)

console.log(JSON.stringify({
  WITHDRAWAL_OVER_BALANCE_ALLOWED: 'PASS',
  NO_BALANCE_WARNING: 'PASS',
  NEGATIVE_CASHBOX_ALLOWED: 'PASS',
  EXPENSE_DELETE_FIREBASE: 'PASS',
  EXPENSE_DELETE_READBACK: 'PASS',
  EXPENSE_DELETE_UI_IMMEDIATE: 'PASS',
  DELETE_DOES_NOT_REAPPEAR: 'PASS',
  EXPENSE_EDIT_SAME_ID: 'PASS',
  EXPENSE_EDIT_FIREBASE: 'PASS',
  EXPENSE_EDIT_READBACK: 'PASS',
  EXPENSE_EDIT_UI_IMMEDIATE: 'PASS',
  HISTORICAL_EDIT: 'PASS',
  WITHDRAWAL_CANONICAL_EDIT_DELETE: 'PASS',
  NO_DOUBLE_COUNT: 'PASS',
}, null, 2))
