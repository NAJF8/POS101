import assert from 'node:assert/strict'
import { buildEmployeeReport, filterEmployeeSummaries, matchEmployeeRecord } from '../src/services/employeeReport.js'

const staff = [
  { id: 's1', code: '101-E01', name: 'علي', active: true },
  { id: 's2', code: '101-E02', name: 'سارة', active: true },
]
const sales = [
  { id: 'sale-1', orderNumber: 10, employeeId: 's1', cashierNameSnapshot: 'علي', businessDate: '2026-10-05', paymentMethod: 'cash', total: 1000, createdAt: 1 },
  { id: 'sale-2', orderNumber: 11, cashierNameSnapshot: 'سارة', businessDate: '2026-10-05', paymentMethod: 'electronic', total: 500, createdAt: 1 },
  { id: 'sale-old', employeeId: 's1', businessDate: '2026-09-30', paymentMethod: 'cash', total: 900, createdAt: 1 },
]
const expenses = [
  { id: 'expense-1', employeeId: 's1', businessDate: '2026-10-05', amount: 100, category: 'مشتريات' },
  { id: 'expense-old', employeeNameSnapshot: 'علي', businessDate: '2026-09-30', amount: 250 },
]
const transactions = [
  { id: 'withdrawal-1', type: 'withdrawal', cashierId: 's1', businessDate: '2026-10-05', amount: 200 },
  { id: 'deposit-ignored', type: 'deposit', cashierId: 's1', businessDate: '2026-10-05', amount: 999 },
]

assert.equal(matchEmployeeRecord({ employeeId: 's1' }, staff).name, 'علي')
assert.equal(matchEmployeeRecord({ cashierNameSnapshot: 'سارة' }, staff).code, '101-E02')
assert.equal(filterEmployeeSummaries([{ employee: staff[0] }], '101-E01').length, 1)
const report = buildEmployeeReport({ staff, sales, expenses, transactions, from: '2026-10-01', to: '2026-10-31' })
const ali = report.summaries.find(row => row.employee.id === 's1')
const sara = report.summaries.find(row => row.employee.id === 's2')
assert.equal(ali.ordersCount, 1)
assert.equal(ali.salesTotal, 1000)
assert.equal(ali.expensesTotal, 100)
assert.equal(ali.withdrawalsTotal, 200)
assert.equal(ali.netTotal, 700)
assert.equal(sara.salesTotal, 500)
assert.equal(report.total.netTotal, 1200)
const historical = buildEmployeeReport({ staff, sales, expenses, transactions, from: '2026-09-01', to: '2026-09-30' })
assert.equal(historical.summaries.find(row => row.employee.id === 's1').expensesTotal, 250)
console.log(JSON.stringify({ EMPLOYEE_SEARCH_BY_NAME: 'PASS', EMPLOYEE_SEARCH_BY_CODE: 'PASS', EMPLOYEE_SALES_TOTAL: 'PASS', EMPLOYEE_EXPENSES_TOTAL: 'PASS', EMPLOYEE_WITHDRAWALS_TOTAL: 'PASS', EMPLOYEE_NET_TOTAL: 'PASS', MONTH_FILTER: 'PASS', LEGACY_NAME_MATCH: 'PASS', HISTORICAL_EXPENSE_MONTH: 'PASS', ALL_EMPLOYEES_MONTHLY: 'PASS' }, null, 2))
