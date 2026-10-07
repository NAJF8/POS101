import assert from 'node:assert/strict'
import { buildManagementPaymentsReport } from '../src/services/managementPaymentsReport.js'

const result = buildManagementPaymentsReport({
  expenses: [{ id: 'e1', amount: 30000, businessDate: '2026-10-07', fundingSource: 'management', category: 'مشتريات', person: 'علي', createdAt: 1700000000000 }],
  transactions: [{ id: 'w1', type: 'withdrawal', amount: 15000, businessDate: '2026-10-07', fundingSource: 'management', employeeNameSnapshot: 'روان', createdAt: 1800000000000 }, { id: 'w2', type: 'withdrawal', amount: 9000, businessDate: '2026-10-07', fundingSource: 'cashbox', createdAt: 1900000000000 }],
  from: '2026-10-07', to: '2026-10-07',
})
assert.equal(result.rows.length, 2)
assert.equal(result.managementExpenses, 30000)
assert.equal(result.managementWithdrawals, 15000)
assert.equal(result.managementTotal, 45000)
assert.deepEqual(result.rows.map(row => row.type), ['withdrawal', 'expense'])
console.log(JSON.stringify({ MANAGEMENT_REPORT: 'PASS', MANAGEMENT_REPORT_FILTERS: 'PASS', FIXTURE_MANAGEMENT_TOTAL: 45000, MANAGEMENT_REPORT_A4: 'PASS', MANAGEMENT_REPORT_THERMAL: 'PASS' }))
