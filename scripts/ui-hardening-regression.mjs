import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const app = read('src/App.jsx')
const dashboard = read('src/components/Dashboard.jsx')
const settings = read('src/components/Settings.jsx')
const expenses = read('src/components/Expenses.jsx')
const sync = read('src/services/posCentralSync.js')

for (const source of [app, dashboard, settings, expenses]) {
  assert.doesNotMatch(source, /إصلاح ومزامنة النظام/)
  assert.doesNotMatch(source, /مزامنة واسترجاع كل المصاريف/)
  assert.doesNotMatch(source, /مزامنة الآن/)
}
assert.doesNotMatch(app, /FullRecoveryDialog|createFullRecoveryClickHandler|handleFullRecovery/)
assert.doesNotMatch(dashboard, /fullRecovery|onFullRecovery/)
assert.doesNotMatch(settings, /fullRecovery|onFullRecovery/)
assert.doesNotMatch(expenses, /fullRecoveryController|runExpenseCentralSync|readCentralExpensesForReports|masterRecovery|manualOpen|recoveryScan/)

assert.match(expenses, /subscribeCentralExpenses/)
assert.match(expenses, /saveCentralExpense/)
assert.match(expenses, /saveCentralExpenseWithCashbox/)
assert.match(sync, /export const subscribeCentralExpenses/)
assert.match(sync, /export const runExpenseCentralSync/)
assert.match(sync, /cacheCentralExpenses\(expenses\)/)
assert.match(sync, /syncStatus: 'pending'/)
assert.match(sync, /EXPENSE_EDIT_READBACK_FAILED/)
assert.match(app, /runExpenseCentralSync\(\{ initial: true \}\)/)
assert.match(app, /runCashierCentralSync\(\)/)

console.log('MANUAL_SYSTEM_REPAIR_UI_REMOVED=PASS')
console.log('MANUAL_EXPENSE_SYNC_UI_REMOVED=PASS')
console.log('EXPENSE_AUTO_SYNC=PASS')
console.log('EXPENSE_REALTIME=PASS')
console.log('NO_MANUAL_SYNC_REQUIRED=PASS')
