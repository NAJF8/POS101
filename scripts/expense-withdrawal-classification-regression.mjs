import assert from 'node:assert/strict'
import fs from 'node:fs'
import { calculateSettlement } from '../src/services/financialCenter.js'
import { normalizeCashOutflowReport } from '../src/services/cashOutflowReport.js'

const source = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
assert.match(source, /if \(category === 'سحوبات'\) \{[\s\S]*?saveCashboxTransaction\(/)
assert.match(source, /await \(fundingSource === 'cashbox' \? saveCentralExpenseWithCashbox\(row\) : saveCentralExpense\(row\)\)/)
assert.match(source, /سحوبات \(حركة صندوق\)/)
console.log('EXPENSE_SAVE_GOES_TO_EXPENSES=PASS')
console.log('WITHDRAWAL_SAVE_GOES_TO_WITHDRAWALS=PASS')

const expenses = [{
  id: 'cash-e36b5748-f4dd-40a7-bcbd-f87e23d46baf', amount: 50000,
  category: 'أخرى', description: '109', businessDate: '2026-10-07',
  operationalDayId: 'day', fundingSource: 'cashbox', status: 'active',
  reclassificationReason: 'RECLASSIFIED_WITHDRAWAL_TO_EXPENSE',
}]
const transactions = [
  { id: 'cash-e36b5748-f4dd-40a7-bcbd-f87e23d46baf', type: 'withdrawal', amount: 50000, businessDate: '2026-10-07', status: 'voided' },
  { id: 'expense-cash-e36b5748-f4dd-40a7-bcbd-f87e23d46baf', type: 'expense', amount: 50000, linkedExpenseId: expenses[0].id, businessDate: '2026-10-07', status: 'active' },
]
const rows = normalizeCashOutflowReport({ expenses, transactions })
assert.equal(rows.filter(row => row.source === 'expense').reduce((sum, row) => sum + row.amount, 0), 50000)
assert.equal(rows.filter(row => String(row.typeLabel).startsWith('سحوبات')).reduce((sum, row) => sum + row.amount, 0), 0)
assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 50000)
console.log('RECLASSIFICATION_NO_DUPLICATE=PASS')

const settlement = calculateSettlement({
  sales: [{ total: 0, paymentMethod: 'cash' }],
  expenses,
  transactions,
})
assert.equal(settlement.cashboxExpenses, 50000)
assert.equal(settlement.cashboxWithdrawals, 0)
console.log('END_DAY_EXPENSES_TOTAL=PASS')
console.log('END_DAY_WITHDRAWALS_TOTAL=PASS')
console.log('REPORT_TOTAL_MATCHES_CANONICAL=PASS')
