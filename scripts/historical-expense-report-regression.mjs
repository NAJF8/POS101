import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getExpensesForBusinessDate, resolveExpenseBusinessDate } from '../src/services/expenseReporting.js'

const operationalDayDates = { 'day-27': '2026-09-27', 'day-02': '2026-10-02' }
const existing = { id: 'existing-27', amount: 1000, category: 'مشتريات', description: 'حليب', businessDate: '2026-09-27', operationalDayId: 'day-02', createdAt: '2026-10-02T12:00:00+03:00' }
const rows = [
  existing,
  { id: 'explicit-02', amount: 2000, businessDate: '2026-10-02', description: 'نقل', operationalDayId: 'day-27' },
  { id: 'mapped-27', amount: 3000, description: 'صيانة', operationalDayId: 'day-27', createdAt: '2026-10-04T12:00:00+03:00' },
  { id: 'created-27', amount: 4000, description: 'أدوات', createdAt: '2026-09-26T21:30:00.000Z' },
]

assert.equal(resolveExpenseBusinessDate(existing, { operationalDayDates }), '2026-09-27')
assert.deepEqual(getExpensesForBusinessDate(rows, '2026-09-27', { operationalDayDates }).map(row => row.id), ['existing-27', 'mapped-27', 'created-27'])
assert.deepEqual(getExpensesForBusinessDate(rows, '2026-10-02', { operationalDayDates }).map(row => row.id), ['explicit-02'])
assert.equal(rows[0].amount, 1000)
assert.equal(rows[0].description, 'حليب')

const reports = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
assert.match(reports, /getExpensesForBusinessDate\(expenses, effectiveReportDate, \{ operationalDayDates: expenseOperationalDayDates \}\)/)
assert.doesNotMatch(reports, /filterExpensesByOperationalDay\(expenses, operationalDay\.id\)/)

const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const start = sync.indexOf('export const readCentralExpensesForReports')
const end = sync.indexOf('const mergeCentralExpensesWithPendingLocal')
const readFunction = sync.slice(start, end)
assert.match(readFunction, /get\(expensesRef\(\)\)/)
assert.match(readFunction, /explicitBusinessDate/)
assert.doesNotMatch(readFunction, /\bset\(/)
assert.doesNotMatch(readFunction, /runTransaction/)
console.log('HISTORICAL_EXPENSE_REPORT_REGRESSION=PASS')
