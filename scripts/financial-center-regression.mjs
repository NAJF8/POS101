import assert from 'node:assert/strict'
import fs from 'node:fs'
import { calculateEmployeeExpenseReport, calculateFinancialReport, calculateSettlement, makeSettlementIdempotencyKey } from '../src/services/financialCenter.js'

const operationalDaySource = fs.readFileSync(new URL('../src/components/OperationalDay.jsx', import.meta.url), 'utf8')

const sales = [
  { id: 's1', total: 100, paymentMethod: 'cash', businessDate: '2026-09-27' },
  { id: 's2', total: 50, paymentMethod: 'electronic', businessDate: '2026-09-27' },
  { id: 's3', total: 20, paymentMethod: 'cash', businessDate: '2026-09-28' },
]
const expenses = [{ id: 'e1', amount: 10, person: 'علي', employeeId: 'ali', employeeNameSnapshot: 'علي', businessDate: '2026-09-27' }]
const transactions = [{ id: 'w1', type: 'withdrawal', amount: 15, employeeId: 'ali', employeeNameSnapshot: 'علي', businessDate: '2026-09-27' }, { id: 'd1', type: 'deposit', amount: 5, businessDate: '2026-09-27' }]

assert.equal(calculateSettlement({ sales, expenses, transactions }).expectedCash, 100)
const categorizedWithdrawalSettlement = calculateSettlement({
  sales: [{ total: 177000, paymentMethod: 'cash' }, { total: 44040, paymentMethod: 'electronic' }],
  expenses: [{ amount: 251500, fundingSource: 'cashbox', category: 'سحوبات' }],
  transactions: [],
})
assert.equal(categorizedWithdrawalSettlement.openingCashKnown, false)
assert.equal(categorizedWithdrawalSettlement.openingCashBalance, null)
assert.equal(categorizedWithdrawalSettlement.openingCashBalanceOrZero, 0)
assert.equal(categorizedWithdrawalSettlement.expectedClosingCash, -74500)
assert.equal(categorizedWithdrawalSettlement.cashboxWithdrawals, 0)
assert.equal(categorizedWithdrawalSettlement.dailyCashMovement, -74500)
assert.match(operationalDaySource, /الرصيد المتوقع بالصندوق<\/span><strong className="end-day-number">\{money\(safeSettlementPreview\.expectedClosingCash \?\? \(expectedCashOpening \+ toMoneyNumber\(safeSettlementPreview\.dailyCashMovement, 0\)\)\)\}<\/strong>/)
assert.match(operationalDaySource, /تم احتساب المتوقع بافتراض رصيد بداية اليوم = 0/)
console.log('EXPECTED_END_CASH_USES_ZERO_FALLBACK=PASS')
console.log('EXPECTED_END_CASH_DISPLAY=-74500')
console.log('NO_DOUBLE_WITHDRAWAL_DEDUCTION=PASS')
console.log('END_DAY_TOTAL_MATCHES_CANONICAL=PASS')
assert.equal(calculateFinancialReport({ sales, expenses, transactions, from: '2026-09-27', to: '2026-09-27' }).daily.length, 1)
assert.equal(calculateFinancialReport({ sales, expenses, transactions, from: '2026-09-27', to: '2026-09-27' }).orderCount, 2)
assert.equal(calculateEmployeeExpenseReport(expenses, transactions, { from: '2026-09-27', to: '2026-09-27' })[0].total, 25)
assert.equal(makeSettlementIdempotencyKey('day-1'), 'settlement:day-1')
console.log('FINANCIAL_CENTER_REGRESSION=PASS')
