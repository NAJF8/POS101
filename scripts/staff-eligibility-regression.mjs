import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildEmployeeReport } from '../src/services/employeeReport.js'
import { normalizeStaffCanSell, sellerEligibleStaff, staffCanSell } from '../src/services/staffEligibility.js'
import { filterCaptainCandidates } from '../src/services/captainReport.js'

const haydar = { id: 'h1', name: 'حيدر', code: '109', active: true }
const ali = { id: 'a1', name: 'علي', code: '101', active: true }
const rawLegacyCaptain = { id: 'r1', name: 'روان', code: '102', active: true }
const staff = [haydar, ali, rawLegacyCaptain]

assert.equal(haydar.code, '109')
assert.equal(haydar.active, true)
assert.equal(normalizeStaffCanSell(haydar), false)
assert.equal(staffCanSell(haydar), false)
assert.equal(sellerEligibleStaff(staff).some(row => row.id === haydar.id), false)
assert.equal(filterCaptainCandidates(staff, '').some(row => row.id === haydar.id), false)
assert.equal(sellerEligibleStaff(staff).some(row => row.id === ali.id), true)
assert.equal(sellerEligibleStaff([{ ...rawLegacyCaptain }]).some(row => row.id === rawLegacyCaptain.id), true)

const expenses = [
  { id: 'salary-h1', employeeId: 'h1', category: 'راتب', amount: 300, businessDate: '2026-10-06', notes: 'راتب حيدر' },
  { id: 'expense-h1', employeeId: 'h1', category: 'نقل', amount: 50, businessDate: '2026-10-06' },
]
const transactions = [
  { id: 'salary-tx-h1', type: 'expense', linkedExpenseId: 'salary-h1', employeeId: 'h1', amount: 300, businessDate: '2026-10-06', category: 'راتب' },
  { id: 'withdrawal-h1', type: 'withdrawal', employeeId: 'h1', employeeNameSnapshot: 'حيدر', amount: 125, businessDate: '2026-10-06', reason: 'سلفة' },
]
const report = buildEmployeeReport({ staff, expenses, transactions, from: '2026-10-01', to: '2026-10-31' })
const haydarReport = report.summaries.find(row => row.employee.id === 'h1')
assert.equal(haydarReport.expensesTotal, 50)
assert.equal(haydarReport.salaryTotal, 300)
assert.equal(haydarReport.withdrawalsTotal, 125)
assert.equal(haydarReport.employeeTotal, 475)
assert.equal(haydarReport.expenses.length, 1)
assert.equal(haydarReport.salary.length, 1)
assert.equal(haydarReport.withdrawals.length, 1)

const expensesSource = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
assert.match(expensesSource, /'سحوبات'/)
assert.match(expensesSource, /saveCashboxTransaction/)
assert.match(expensesSource, /type: 'withdrawal'/)
assert.match(expensesSource, /employeeId: personId/)
assert.match(expensesSource, /staff\.filter\(row => row\.active !== false\)/)

console.log(JSON.stringify({
  HAYDAR_CODE_109: 'PASS',
  HAYDAR_ACTIVE_STAFF: 'PASS',
  HAYDAR_CAN_SELL_FALSE: 'PASS',
  HAYDAR_NOT_IN_SELLER_SELECTION: 'PASS',
  HAYDAR_IN_EXPENSE_SELECTOR: 'PASS',
  SALARY_FOR_HAYDAR: 'PASS',
  WITHDRAWAL_FOR_HAYDAR: 'PASS',
  EMPLOYEE_REPORT_HAYDAR: 'PASS',
  NO_WITHDRAWAL_DOUBLE_COUNT: 'PASS',
  EXISTING_CAPTAINS_STILL_VISIBLE: 'PASS',
}, null, 2))
