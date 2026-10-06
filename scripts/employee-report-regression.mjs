import assert from 'node:assert/strict'
import { buildEmployeeReport, filterEmployeeSummaries, matchEmployeeRecord } from '../src/services/employeeReport.js'

const staff = [
  { id: 's1', code: '101-E01', name: 'علي', active: true },
  { id: 's2', code: '101-E02', name: 'سارة', active: true },
]
const sales = [
  { id: 'sale-1', orderNumber: 10, employeeId: 's1', businessDate: '2026-10-05', paymentMethod: 'cash', total: 1000 },
]
const expenses = [
  { id: 'expense-1', employeeId: 's1', businessDate: '2026-10-05', amount: 100, category: 'نقل', description: 'وقود' },
  { id: 'salary-1', employeeId: 's1', businessDate: '2026-10-05', amount: 300, category: 'راتب', notes: 'راتب الشهر' },
  { id: 'expense-old', employeeNameSnapshot: 'علي', businessDate: '2026-09-30', amount: 250, category: 'أخرى' },
]
const transactions = [
  { id: 'expense-tx-1', type: 'expense', linkedExpenseId: 'expense-1', employeeId: 's1', businessDate: '2026-10-05', amount: 100, category: 'نقل' },
  { id: 'salary-tx-1', type: 'expense', linkedExpenseId: 'salary-1', employeeId: 's1', businessDate: '2026-10-05', amount: 300, category: 'راتب' },
  { id: 'withdrawal-1', type: 'withdrawal', cashierId: 's1', businessDate: '2026-10-05', amount: 200, note: 'سلفة' },
]

assert.equal(matchEmployeeRecord({ employeeId: 's1' }, staff).name, 'علي')
assert.equal(matchEmployeeRecord({ employeeNameSnapshot: 'سارة' }, staff).code, '101-E02')
assert.equal(filterEmployeeSummaries([{ employee: staff[0] }], '101-E01').length, 1)
const report = buildEmployeeReport({ staff, sales, expenses, transactions, from: '2026-10-01', to: '2026-10-31' })
const ali = report.summaries.find(row => row.employee.id === 's1')
assert.equal(ali.expensesTotal, 100)
assert.equal(ali.salaryTotal, 300)
assert.equal(ali.withdrawalsTotal, 200)
assert.equal(ali.employeeTotal, 600)
assert.equal(ali.expenses.some(row => row.category === 'راتب'), false)
assert.equal(ali.salary.length, 1)
assert.equal(ali.withdrawals.length, 1)
assert.equal(Object.hasOwn(ali, 'salesTotal'), false)
assert.equal(Object.hasOwn(ali, 'ordersCount'), false)
assert.equal(report.total.employeeTotal, 600)
const historical = buildEmployeeReport({ staff, sales, expenses, transactions, from: '2026-09-01', to: '2026-09-30' })
assert.equal(historical.summaries.find(row => row.employee.id === 's1').expensesTotal, 250)

console.log(JSON.stringify({
  EMPLOYEE_REPORT_NO_SALES: 'PASS',
  EMPLOYEE_REPORT_NO_ORDER_COUNT: 'PASS',
  EMPLOYEE_EXPENSES: 'PASS',
  EMPLOYEE_SALARY: 'PASS',
  EMPLOYEE_WITHDRAWALS: 'PASS',
  EMPLOYEE_TOTAL: 'PASS',
  NO_SALARY_DOUBLE_COUNT: 'PASS',
  EMPLOYEE_SEARCH_BY_NAME: 'PASS',
  EMPLOYEE_SEARCH_BY_CODE: 'PASS',
  BUSINESS_DATE_FILTER: 'PASS',
}, null, 2))
