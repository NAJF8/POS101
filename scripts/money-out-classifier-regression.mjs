import assert from 'node:assert/strict'
import { buildMoneyOutLedger, classifyMoneyOutRecord } from '../src/services/moneyOutClassifier.js'
import { calculateFinancialReport, calculateSettlement } from '../src/services/financialCenter.js'
import { buildCaptainReport } from '../src/services/captainReport.js'
import { normalizeCashOutflowReport } from '../src/services/cashOutflowReport.js'

const day = '2026-10-08'
const extraExpense = { id: '3140d2e7-5e8e-416e-b63e-6bcc56e3d354', amount: 100000, category: 'مشتريات', description: 'سيروبات', employeeId: 'staff-ali-legacy', employeeNameSnapshot: 'علي', fundingSource: 'cashbox', paymentSource: 'cash_drawer', businessDate: day, shiftType: 'morning', derivedTransactionType: 'withdrawal', status: 'disabled' }
const mirrorTransaction = { id: 'expense-3140d2e7-5e8e-416e-b63e-6bcc56e3d354', amount: 100000, type: 'withdrawal', linkedExpenseId: extraExpense.id, employeeId: 'staff-ali-legacy', employeeNameSnapshot: 'علي', employeeCode: '102', fundingSource: 'cashbox', paymentSource: 'cash_drawer', businessDate: day, createdAt: 1791506789191, shiftType: 'morning', status: 'active' }
const withdrawalExpense = { id: 'withdrawal-115500', amount: 115500, category: 'سحوبات', fundingSource: 'cashbox', paymentSource: 'cash_drawer', businessDate: day, status: 'active' }
const otherExpense = { id: 'other-expense-27000', amount: 27000, category: 'مشتريات', description: 'مصاريف أخرى', fundingSource: 'cashbox', paymentSource: 'cash_drawer', businessDate: day, status: 'active' }
const sales = [{ id: 'cash-sales', total: 342000, paymentMethod: 'cash', businessDate: day }, { id: 'electronic-sales', total: 5000, paymentMethod: 'electronic', businessDate: day }]
const expenses = [extraExpense, withdrawalExpense, otherExpense]
const transactions = [mirrorTransaction]

const ledger = buildMoneyOutLedger({ expenses, transactions })
const expenseRow = ledger.find(row => row.recordId === extraExpense.id)
const mirrorRow = ledger.find(row => row.recordId === mirrorTransaction.id)
assert.deepEqual({ includeInReports: expenseRow.includeInReports, reportBucket: expenseRow.reportBucket, cashboxImpact: expenseRow.cashboxImpact, businessDate: expenseRow.businessDate, shiftType: expenseRow.shiftType, employeeId: expenseRow.employeeId }, { includeInReports: true, reportBucket: 'business_expense', cashboxImpact: 'drawer', businessDate: day, shiftType: 'morning', employeeId: 'staff-ali-legacy' })
assert.equal(mirrorRow.includeInReports, false)
assert.equal(mirrorRow.reason, 'linked_expense_mirror')
assert.equal(ledger.filter(row => row.includeInReports && row.amount === 100000).length, 1)
assert.equal(classifyMoneyOutRecord({ amount: 1, businessDate: day, fundingSource: 'mystery', type: 'expense' }).warning, true)
assert.equal(classifyMoneyOutRecord({ amount: 1, businessDate: day, createdAt: Date.parse('2026-10-09T00:00:00Z'), status: 'voided' }).includeInReports, false)

const settlement = calculateSettlement({ sales, expenses, transactions, openingCashBalance: 7000 })
assert.equal(settlement.sales, 347000)
assert.equal(settlement.cashboxExpenses, 127000)
assert.equal(settlement.cashboxWithdrawals, 115500)
assert.equal(settlement.expectedCash, 106500)
const financial = calculateFinancialReport({ sales, expenses, transactions, from: day, to: day })
assert.equal(financial.daily[0].expenses, 127000)
assert.equal(financial.daily[0].withdrawals, 115500)

const captain = buildCaptainReport({ captain: { id: 'staff-ali-legacy', name: 'علي', code: '102' }, staff: [{ id: 'staff-ali-legacy', name: 'علي', code: '102' }], expenses, transactions, from: day, to: day })
assert.equal(captain.expensesTotal, 100000)
assert.equal(captain.withdrawalsTotal, 0)
assert.equal(captain.matchedExpenses.length, 1)
assert.equal(captain.matchedWithdrawals.length, 0)

const cashOutflows = normalizeCashOutflowReport({ expenses, transactions })
assert.equal(cashOutflows.filter(row => row.amount === 100000).length, 1)
assert.equal(cashOutflows.find(row => row.amount === 100000).typeLabel, 'مشتريات')

console.log(JSON.stringify({
  EXTRA_WITHDRAWAL_RECORD_FOUND: 'PASS',
  EXTRA_WITHDRAWAL_ID: mirrorTransaction.id,
  EXTRA_WITHDRAWAL_AMOUNT: mirrorTransaction.amount,
  EXTRA_WITHDRAWAL_EMPLOYEE: `${mirrorTransaction.employeeNameSnapshot}/${mirrorTransaction.employeeCode}`,
  EXTRA_WITHDRAWAL_BUSINESS_DATE: mirrorTransaction.businessDate,
  EXTRA_WITHDRAWAL_CREATED_AT: mirrorTransaction.createdAt,
  EXTRA_WITHDRAWAL_PAYMENT_SOURCE: 'drawer',
  EXTRA_WITHDRAWAL_SHIFT: mirrorTransaction.shiftType,
  EXTRA_WITHDRAWAL_STATUS: mirrorTransaction.status,
  EXTRA_WITHDRAWAL_CLASSIFICATION_REASON: mirrorRow.reason,
  EXTRA_100K_CLASSIFIED_AS_BUSINESS_EXPENSE: 'PASS',
  EXTRA_100K_MIRROR_EXCLUDED: 'PASS',
  CASHBOX_DAY8_WITHDRAWALS_115500: settlement.cashboxWithdrawals === 115500 ? 'PASS' : 'FAIL',
  COMPREHENSIVE_DAY8_WITHDRAWALS_115500: financial.daily[0].withdrawals === 115500 ? 'PASS' : 'FAIL',
  CAPTAIN_REPORT_DAY8_WITHDRAWALS_MATCH_CLASSIFIER: captain.withdrawalsTotal === 0 ? 'PASS' : 'FAIL',
  DAY8_REPORT_WITHDRAWALS_115500: 'PASS',
  DAY8_EXPECTED_CASH_106500: settlement.expectedCash === 106500 ? 'PASS' : 'FAIL',
  REPORT_CASHBOX_WITHDRAWAL_MATCH: financial.daily[0].withdrawals === settlement.cashboxWithdrawals ? 'PASS' : 'FAIL',
  CAPTAIN_ALI_102_WITHDRAWALS_NO_EXTRA_100K: 'PASS',
  NO_DOUBLE_COUNTING: 'PASS',
  UNKNOWN_SOURCE_WARNING: 'PASS',
  VOIDED_EXCLUDED: 'PASS',
}, null, 2))
