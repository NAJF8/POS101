import assert from 'node:assert/strict'
import { filterCashOutflowReport, normalizeCashOutflowReport, sumCashOutflowReport } from '../src/services/cashOutflowReport.js'

const rows = normalizeCashOutflowReport({
  expenses: [
    { id: 'expense-1', category: 'مشتريات', amount: 20000, description: 'مستلزمات', businessDate: '2026-10-07', createdAt: 1 },
    { id: 'salary-1', category: 'راتب', amount: 30000, description: 'راتب يومي', employeeId: 'h', businessDate: '2026-10-07', createdAt: 2, linkedTransactionId: 'salary-tx' },
    { id: 'electronic-1', category: 'أخرى', amount: 9000, paymentSource: 'electronic', businessDate: '2026-10-07' },
  ],
  transactions: [
    { id: 'withdrawal-1', type: 'withdrawal', amount: 10000, employeeId: 'h', employeeNameSnapshot: 'حيدر', employeeCode: '109', reason: 'سحب شخصي', businessDate: '2026-10-07', createdAt: 3 },
    { id: 'salary-tx', type: 'expense', linkedExpenseId: 'salary-1', amount: 30000, businessDate: '2026-10-07' },
    { id: 'deposit-1', type: 'deposit', amount: 5000, businessDate: '2026-10-07' },
    { id: 'voided-1', type: 'withdrawal', amount: 7000, status: 'voided', businessDate: '2026-10-07' },
    { id: 'settlement-1', type: 'settlement', amount: 60000, businessDate: '2026-10-07' },
  ],
})

assert.equal(rows.length, 3)
assert.equal(sumCashOutflowReport(rows), 60000)
assert.equal(rows.find(row => row.typeLabel === 'راتب')?.amount, 30000)
assert.equal(rows.find(row => row.typeLabel === 'سحوبات')?.employeeCode, '109')
assert.equal(filterCashOutflowReport(rows, '2026-10-07', '2026-10-07', 'salary').length, 1)
assert.equal(filterCashOutflowReport(rows, '2026-10-07', '2026-10-07', 'withdrawals').length, 1)
assert.equal(normalizeCashOutflowReport({ transactions: [{ id: 'manual-1', type: 'manual_cash_out', amount: 1, businessDate: '2026-10-07' }] })[0].typeLabel, 'أخرى')
console.log(JSON.stringify({ NORMAL_EXPENSE_INCLUDED: 'PASS', SALARY_INCLUDED: 'PASS', WITHDRAWAL_INCLUDED: 'PASS', OTHER_CASH_OUT_INCLUDED: 'PASS', DEPOSIT_EXCLUDED: 'PASS', VOIDED_EXCLUDED: 'PASS', NO_DOUBLE_COUNT: 'PASS', MAIN_EXPENSE_TOTAL: 60000 }, null, 2))
