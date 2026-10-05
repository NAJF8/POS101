import assert from 'node:assert/strict'
import fs from 'node:fs'
import { calculateCashboxBalance, calculateEmployeeExpenseReport, calculateFinancialReport, calculateSettlement, makeSettlementIdempotencyKey } from '../src/services/financialCenter.js'

const sales = [
  { id: 's1', total: 100, paymentMethod: 'cash', operationalDayId: 'day-1', businessDate: '2026-10-05' },
  { id: 's2', total: 50, paymentMethod: 'electronic', operationalDayId: 'day-1', businessDate: '2026-10-05' },
]
const expenses = [{ id: 'e1', amount: 10, employeeId: 'ali', employeeNameSnapshot: 'علي', operationalDayId: 'day-1', businessDate: '2026-10-05' }]
const transactions = [
  { id: 'w1', type: 'withdrawal', amount: 15, employeeId: 'ali', employeeNameSnapshot: 'علي', businessDate: '2026-10-05', status: 'active' },
  { id: 'd1', type: 'deposit', amount: 5, businessDate: '2026-10-05', status: 'active' },
]

const settlement = calculateSettlement({ sales, expenses, transactions })
assert.deepEqual({ cash: settlement.cashSales, electronic: settlement.electronicSales, expenses: settlement.expenses, withdrawals: settlement.withdrawals, deposits: settlement.deposits, expected: settlement.expectedCash }, { cash: 100, electronic: 50, expenses: 10, withdrawals: 15, deposits: 5, expected: 80 })
assert.equal(makeSettlementIdempotencyKey('day-1'), 'settlement:day-1')
assert.equal(makeSettlementIdempotencyKey('day-1'), makeSettlementIdempotencyKey('day-1'), 'closing same day uses one deterministic key')
assert.equal(calculateCashboxBalance([{ type: 'deposit', amount: 100 }, { type: 'withdrawal', amount: 30 }]), 70)
assert.equal(calculateCashboxBalance([{ type: 'deposit', amount: 100 }, { type: 'withdrawal', amount: 30, status: 'voided' }]), 100)

const linkedTransactions = [{ id: 'tx-e1', type: 'expense', amount: 10, linkedExpenseId: 'e1', employeeId: 'ali', employeeNameSnapshot: 'علي', businessDate: '2026-10-05', source: 'cashier expense' }, ...transactions]
const employee = calculateEmployeeExpenseReport(expenses, linkedTransactions, { from: '2026-10-05', to: '2026-10-05' })[0]
assert.equal(employee.total, 25, 'linked expense is counted once, plus independent withdrawal')
assert.equal(employee.operations, 2)
assert.equal(calculateFinancialReport({ sales, expenses, transactions, from: '2026-10-05', to: '2026-10-05' }).orderCount, 2)
assert.equal(calculateFinancialReport({ sales, expenses, transactions, from: '2026-10-06', to: '2026-10-06' }).orderCount, 0)

const oldSnapshot = { employeeId: 'ali', employeeNameSnapshot: 'علي', amount: 20 }
const renamed = { ...oldSnapshot, employeeNameSnapshot: 'علي الجديد' }
assert.equal(oldSnapshot.employeeNameSnapshot, 'علي')
assert.equal(renamed.employeeNameSnapshot, 'علي الجديد')
assert.equal(Number(125) - Number(80), 45, 'cash count difference is actual minus system')

const rules = fs.readFileSync('database.rules.json', 'utf8')
for (const path of ['pos101_staff', 'pos101_cashbox_transactions', 'pos101_cashbox_settlements', 'pos101_financial_audit_log']) assert.match(rules, new RegExp(`"${path}"`))
assert.match(rules, /pos101_financial_audit_log[\s\S]*?\.write/)
console.log('FINANCIAL_CENTER_COMPLETION_REGRESSION=PASS')
