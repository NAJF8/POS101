import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildCaptainReport, matchCaptainRecord } from '../src/services/captainReport.js'
import { buildEmployeeReport, matchesEmployee } from '../src/services/employeeReport.js'

const staff = [{ id: 'staff-ali', code: '102', name: 'علي', active: true }, { id: 'staff-sara', code: '103', name: 'سارة', active: true }]
const sales = [
  { id: 's1', orderNumber: 2001, cashierCode: '102', businessDate: '2026-10-01', total: 100000, paymentMethod: 'cash', status: 'completed', createdAt: '2026-10-01T08:00:00+03:00' },
  { id: 's2', orderNumber: 2002, sellerName: 'علي', businessDate: '2026-10-09', total: 50000, payment: { method: 'electronic' }, status: 'sold', createdAt: '2026-10-09T18:00:00+03:00' },
  { id: 's3', orderNumber: 2003, cashierNameSnapshot: 'علي', businessDate: '2026-10-09', total: 90000, paymentMethod: 'cash', status: 'cancelled' },
  { id: 's4', orderNumber: 2004, cashierCode: '103', businessDate: '2026-10-05', total: 70000, paymentMethod: 'cash', status: 'completed' },
  { id: 's5', orderNumber: 2005, cashierCode: '102', businessDate: '2026-09-30', total: 80000, paymentMethod: 'cash', status: 'completed' },
]
const expenses = [{ id: 'e1', employeeCode: '102', businessDate: '2026-10-09', amount: 586000, category: 'نقل' }]
const transactions = [{ id: 'w1', type: 'withdrawal', cashierCode: '102', businessDate: '2026-10-09', amount: 25000, status: 'active' }]

assert.equal(matchesEmployee(sales[0], staff[0]), true)
assert.equal(matchesEmployee(sales[1], staff[0]), true)
assert.equal(matchCaptainRecord(sales[0], staff[0], staff), true)
const report = buildCaptainReport({ captain: staff[0], staff, sales, expenses, transactions, from: '2026-10-01', to: '2026-10-09', sections: ['sales', 'expenses', 'withdrawals'] })
assert.deepEqual(report.sales.map(row => row.id), ['s1', 's2'])
assert.equal(report.salesTotal, 150000)
assert.equal(report.cashSales, 100000)
assert.equal(report.electronicSales, 50000)
assert.equal(report.sales.length, 2)
assert.equal(report.expensesTotal, 586000)
assert.equal(report.withdrawalsTotal, 25000)
assert.equal(report.netTotal, -461000)
assert.deepEqual(report.matchedSales.map(row => row.id), ['s1', 's2'])
assert.equal(report.totals.totalSales, report.matchedSales.reduce((sum, row) => sum + row.total, 0))
assert.equal(report.totals.cashSales, 100000)
assert.equal(report.totals.electronicSales, 50000)
assert.equal(report.totals.businessExpensesTotal, 586000)
assert.equal(report.totals.withdrawalsTotal, 25000)
assert.equal(report.totals.net, 100000 + 50000 - 586000 - 25000)
const linkedWithdrawal = buildCaptainReport({ captain: staff[0], sales: [], expenses: [{ id: 'linked-expense', employeeCode: '102', businessDate: '2026-10-09', amount: 25000, category: 'سحوبات' }], transactions: [{ id: 'linked-transaction', type: 'withdrawal', linkedExpenseId: 'linked-expense', cashierCode: '102', businessDate: '2026-10-09', amount: 25000 }], from: '2026-10-01', to: '2026-10-09' })
assert.equal(linkedWithdrawal.totals.withdrawalsTotal, 25000)
assert.equal(linkedWithdrawal.matchedExpenses.length, 0)
const employeeReport = buildEmployeeReport({ staff, sales, expenses, transactions, from: '2026-10-01', to: '2026-10-09' })
const ali = employeeReport.summaries.find(row => row.employee.id === 'staff-ali')
assert.equal(ali.salesTotal, report.salesTotal)
assert.equal(ali.ordersCount, report.sales.length)
assert.equal(ali.cashSales, report.cashSales)
assert.equal(ali.electronicSales, report.electronicSales)
assert.equal(ali.expensesTotal, 586000)
assert.equal(ali.withdrawalsTotal, 25000)

const reportSource = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
const syncSource = fs.readFileSync(new URL('../src/services/salesSyncQueue.js', import.meta.url), 'utf8')
assert.match(reportSource, /CAPTAIN_REPORT_DIAGNOSTIC/)
assert.match(reportSource, /CAPTAIN_REPORT_RENDER_DIAGNOSTIC/)
assert.match(reportSource, /captainReportData/)
assert.match(reportSource, /printWindow\.print\(\)/)
assert.match(reportSource, /captain-report-print-a4/)
assert.match(reportSource, /matchesEmployee\(row, selectedCaptain\)/)
assert.match(reportSource, /businessDateOf\(row\)/)
assert.match(syncSource, /markSaleSynced/)
assert.doesNotMatch(reportSource, /localStorage\.clear\(/)

console.log(JSON.stringify({
  CAPTAIN_REPORT_SALES_MATCHER_FIX: 'PASS',
  ALI_102_SALES_VISIBLE_IN_REPORT: 'PASS',
  CAPTAIN_REPORT_ORDER_ROWS_VISIBLE: 'PASS',
  CAPTAIN_REPORT_CASH_TOTAL_CORRECT: 'PASS',
  CAPTAIN_REPORT_ELECTRONIC_TOTAL_CORRECT: 'PASS',
  CAPTAIN_REPORT_EXCLUDES_VOIDED_CANCELLED: 'PASS',
  CAPTAIN_REPORT_DATE_RANGE_INCLUSIVE: 'PASS',
  EMPLOYEE_MATCHES_SALES_BY_CODE_OR_NAME: 'PASS',
  EXPENSES_WITHDRAWALS_STILL_MATCH_EMPLOYEE: 'PASS',
  EMPLOYEE_REPORT_CLASSIFICATION_STILL_CORRECT: 'PASS',
  CAPTAIN_REPORT_SHARED_DATASET: 'PASS',
  CAPTAIN_REPORT_SUMMARY_USES_VISIBLE_ROWS: 'PASS',
  CAPTAIN_REPORT_NET_FORMULA_CORRECT: 'PASS',
  CAPTAIN_REPORT_NO_LINKED_DOUBLE_COUNTING: 'PASS',
  CAPTAIN_REPORT_PRINT_HANDLER_PRESENT: 'PASS',
  NO_DOUBLE_COUNTING: 'PASS',
  SYNC_SAFETY_UNCHANGED: 'PASS',
}, null, 2))
