import assert from 'node:assert/strict'
import { calculateSettlement } from '../src/services/financialCenter.js'
import { reconcilePreCloseSales } from '../src/services/preCloseReconciliation.js'
import { getReportSalesForOperationalDay, getReportSalesForPeriod } from '../src/services/reportSales.js'
import { day, expense, fixtureDays, sale, transaction } from './fixtures/all-days-financial-invariants.fixture.mjs'

const d = fixtureDays
const close = (inputs, actualCash) => {
  const calculated = calculateSettlement(inputs)
  const difference = actualCash - calculated.expectedCash
  return { ...calculated, actualCash, difference, status: difference === 0 ? 'matched' : difference > 0 ? 'over' : 'short' }
}

const day1 = close({
  sales: [sale({ id: 'd1-cash', dayId: d.matched.id, businessDate: d.matched.businessDate, total: 100000 }), sale({ id: 'd1-card', dayId: d.matched.id, businessDate: d.matched.businessDate, total: 50000, paymentMethod: 'electronic' })],
  expenses: [expense({ id: 'd1-exp', dayId: d.matched.id, businessDate: d.matched.businessDate, amount: 20000 })],
  transactions: [transaction({ id: 'd1-wd', dayId: d.matched.id, businessDate: d.matched.businessDate, type: 'withdrawal', amount: 10000 }), transaction({ id: 'd1-dep', dayId: d.matched.id, businessDate: d.matched.businessDate, type: 'deposit', amount: 5000 })],
}, 75000)
assert.equal(day1.expectedCash, 75000)
assert.equal(day1.status, 'matched')

const day2 = close({ sales: [sale({ id: 'd2-cash', dayId: d.shortage.id, businessDate: d.shortage.businessDate, total: 100000 })] }, 90000)
assert.deepEqual({ expected: day2.expectedCash, difference: day2.difference, status: day2.status }, { expected: 100000, difference: -10000, status: 'short' })

const day3 = calculateSettlement({ sales: [sale({ id: 'd3-discount', dayId: d.discount.id, businessDate: d.discount.businessDate, subtotal: 100000, total: 90000, discount: 10000, paymentMethod: 'electronic' })] })
assert.deepEqual({ sales: day3.sales, cash: day3.cashSales, electronic: day3.electronicSales }, { sales: 90000, cash: 0, electronic: 90000 })

const day4 = calculateSettlement({
  sales: [sale({ id: 'd4-cash', dayId: d.salaryWithdrawal.id, businessDate: d.salaryWithdrawal.businessDate, total: 100000 })],
  expenses: [expense({ id: 'd4-ordinary', dayId: d.salaryWithdrawal.id, businessDate: d.salaryWithdrawal.businessDate, amount: 20000 }), expense({ id: 'd4-salary', dayId: d.salaryWithdrawal.id, businessDate: d.salaryWithdrawal.businessDate, amount: 30000, category: 'راتب' })],
  transactions: [transaction({ id: 'd4-wd', dayId: d.salaryWithdrawal.id, businessDate: d.salaryWithdrawal.businessDate, type: 'withdrawal', amount: 15000 })],
})
assert.equal(day4.expenses, 50000)
assert.equal(day4.expectedCash, 35000)

const offlineSale = sale({ id: 'd5-offline', dayId: d.offline.id, businessDate: d.offline.businessDate, total: 12000, operationKey: 'pos101:d5-offline' })
assert.equal(reconcilePreCloseSales({ localSales: [offlineSale], queueEntries: [{ sale: offlineSale }], centralSales: [], operationalDay: d.offline }).allowed, false)
assert.equal(reconcilePreCloseSales({ localSales: [offlineSale], queueEntries: [], centralSales: [offlineSale], operationalDay: d.offline }).allowed, true)

const day6Sales = [sale({ id: 'd6-valid', dayId: d.voided.id, businessDate: d.voided.businessDate, total: 10000 }), sale({ id: 'd6-voided', dayId: d.voided.id, businessDate: d.voided.businessDate, total: 50000, status: 'voided' }), sale({ id: 'd6-cancelled', dayId: d.voided.id, businessDate: d.voided.businessDate, total: 25000, status: 'cancelled' })]
assert.equal(calculateSettlement({ sales: day6Sales }).orderCount, 1)
assert.equal(calculateSettlement({ sales: day6Sales }).sales, 10000)

const day7Sale = sale({ id: 'd7-central', dayId: d.staleCache.id, businessDate: d.staleCache.businessDate, total: 11000 })
const stale = sale({ id: 'stale-local', dayId: 'old-day', businessDate: d.staleCache.businessDate, total: 99000 })
assert.deepEqual(getReportSalesForOperationalDay({ centralSales: [day7Sale, stale], operationalDayId: d.staleCache.id, businessDate: d.staleCache.businessDate }).map(row => row.id), ['d7-central'])

const day8 = calculateSettlement({ sales: [sale({ id: 'd8-card', dayId: d.electronicOnly.id, businessDate: d.electronicOnly.businessDate, total: 45000, paymentMethod: 'electronic' })] })
assert.deepEqual({ cash: day8.cashSales, electronic: day8.electronicSales, expected: day8.expectedCash }, { cash: 0, electronic: 45000, expected: 0 })

const day9Sales = [sale({ id: 'd9-before-midnight', dayId: d.midnight.id, businessDate: d.midnight.businessDate, total: 10000, createdAt: 1 }), sale({ id: 'd9-after-midnight', dayId: d.midnight.id, businessDate: d.midnight.businessDate, total: 12000, createdAt: 2 })]
assert.equal(calculateSettlement({ sales: day9Sales }).orderCount, 2)

const historical = sale({ id: 'd10-central', dayId: d.historicalAfterOpen.id, businessDate: d.historicalAfterOpen.businessDate, total: 13000 })
const newerLocal = sale({ id: 'new-open-local', dayId: 'day-11', businessDate: d.historicalAfterOpen.businessDate, total: 99000 })
const periodRows = getReportSalesForPeriod({ localSales: [historical, newerLocal], centralSales: [historical], operationalDays: [d.historicalAfterOpen, day('day-11', '2026-10-11', 'open')], from: d.historicalAfterOpen.businessDate, to: d.historicalAfterOpen.businessDate, currentOperationalDay: day('day-11', '2026-10-11', 'open') })
assert.deepEqual(periodRows.map(row => row.id), ['d10-central'])

console.log(JSON.stringify({ MULTI_DAY_ISOLATION: 'PASS', NO_CROSS_DAY_LEAK: 'PASS', NO_DUPLICATE_FINANCIAL_COUNT: 'PASS', EXPECTED_CASH_FORMULA: 'PASS', QUEUE_CLOSE_GUARD: 'PASS', CLOSED_DAY_CENTRAL_ONLY: 'PASS', SCENARIOS: 10, PRODUCTION_WRITES: 'NO' }, null, 2))
