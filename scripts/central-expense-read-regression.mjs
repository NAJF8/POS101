import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getExpensesForBusinessDate, mergeExpensesConservatively } from '../src/services/expenseReporting.js'

const central = [{ id: 'central-27', amount: 1000, businessDate: '2026-09-27', description: 'مركزي' }]
const emptyLocalAdmin = []
const mergedFromEmptyAdmin = mergeExpensesConservatively(emptyLocalAdmin, central)
assert.deepEqual(mergedFromEmptyAdmin.map(row => row.id), ['central-27'])
assert.equal(getExpensesForBusinessDate(mergedFromEmptyAdmin, '2026-09-27').length, 1)

const local = [{ id: 'local-1', amount: 500, businessDate: '2026-09-26', description: 'محلي' }]
const pending = [{ id: 'pending-1', amount: 700, businessDate: '2026-09-27', description: 'بانتظار الرفع', syncStatus: 'pending' }]
const mergedRemoteEmpty = mergeExpensesConservatively([...local, ...pending], [])
assert.equal(mergedRemoteEmpty.length, 2)
assert.equal(mergedRemoteEmpty.find(row => row.id === 'pending-1').syncStatus, 'pending')

const reports = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
assert.match(reports, /readCentralExpensesForReports\(\)/)
assert.match(reports, /getExpensesForBusinessDate\(expenses, effectiveReportDate/)
const expenses = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
assert.match(expenses, /readCentralExpensesForReports\(/)
assert.match(expenses, /تحديث المصاريف من Firebase/)
const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
assert.match(sync, /await isAuthorizedPosSyncUser\(user\)/)
const subscription = sync.slice(sync.indexOf('export const subscribeCentralExpenses'), sync.indexOf('export const runExpenseCentralSync'))
assert.match(subscription, /isAuthorizedPosSyncUser\(user\)/)
assert.doesNotMatch(subscription, /isOperationalDayUser\(auth\?\.currentUser\)/)
console.log('CENTRAL_EXPENSE_READ_REGRESSION=PASS')
