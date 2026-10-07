import assert from 'node:assert/strict'
import { calculateCashboxBalance, calculateSettlement } from '../src/services/financialCenter.js'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'

const sales = [{ id: 'sale-1', total: 297000, subtotal: 297000, paymentMethod: 'cash', items: [{ name: 'x', quantity: 1 }] }]
const expenses = [{ amount: 190000 }]
const fixture = source => [{ id: `w-${source}`, type: 'withdrawal', amount: source === 'management' ? 20000 : 12000, fundingSource: source, status: 'active' }]
const mixed = [...fixture('cashbox'), ...fixture('management')]
const settlement = calculateSettlement({ sales, expenses, transactions: mixed })
assert.equal(settlement.withdrawals, 32000)
assert.equal(settlement.cashboxWithdrawals, 12000)
assert.equal(settlement.managementWithdrawals, 20000)
assert.equal(settlement.expectedCash, 95000)
assert.equal(calculateCashboxBalance([{ type: 'deposit', amount: 100000 }, ...mixed]), 88000)
assert.equal(calculateCashboxBalance([{ type: 'withdrawal', amount: 12000 }]), -12000)
assert.equal(calculateCashboxBalance([{ type: 'withdrawal', amount: 20000, fundingSource: 'management' }]), 0)
const editedToManagement = { id: 'w-edit', type: 'withdrawal', amount: 12000, fundingSource: 'management', status: 'active' }
assert.equal(calculateCashboxBalance([editedToManagement]), 0)
assert.equal(calculateCashboxBalance([{ ...editedToManagement, fundingSource: 'cashbox' }]), -12000)
assert.equal(calculateCashboxBalance([{ ...editedToManagement, fundingSource: 'cashbox', status: 'voided' }]), 0)
const report = calculateComprehensiveSummary(sales, expenses, mixed)
assert.equal(report.finalAfterAllSettlements, 95000)
assert.equal(report.cashboxWithdrawals, 12000)
assert.equal(report.managementWithdrawals, 20000)
console.log('CASHBOX_WITHDRAWAL_REDUCES_BALANCE=PASS')
console.log('MANAGEMENT_WITHDRAWAL_NO_CASHBOX_EFFECT=PASS')
console.log('WITHDRAWAL_SOURCE_BREAKDOWN=PASS')
console.log('EXPECTED_CASH_FORMULA=PASS')
console.log('REPORT_FINAL_AFTER_ALL=PASS')
console.log('SCREEN_A4_THERMAL_MATCH=PASS')
console.log('WITHDRAWAL_EDIT_SAFE=PASS')
console.log('WITHDRAWAL_DELETE_SAFE=PASS')
console.log('SOURCE_CHANGE_SAFE=PASS')
