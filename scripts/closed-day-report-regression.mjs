import assert from 'node:assert/strict'
import { getReportSalesForPeriod, isReportableSale } from '../src/services/reportSales.js'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'
import { calculateSettlement } from '../src/services/financialCenter.js'

const dayId = '664f9d14-6e32-469e-909a-1bed117212bd'
const businessDate = '2026-10-06'
const centralSales = [
  ...Array.from({ length: 27 }, (_, index) => ({ id: `cash-${index}`, operationalDayId: dayId, businessDate, subtotal: index === 0 ? 26490 : 11000, discount: index === 0 ? 15490 : 0, total: 11000, paymentMethod: 'cash' })),
  ...Array.from({ length: 5 }, (_, index) => ({ id: `electronic-${index}`, operationalDayId: dayId, businessDate, subtotal: 5000, discount: 0, total: 5000, paymentMethod: 'electronic' })),
  { id: 'electronic-last', operationalDayId: dayId, businessDate, subtotal: 7510, discount: 0, total: 7510, paymentMethod: 'electronic' },
  { id: 'voided-central', operationalDayId: dayId, businessDate, subtotal: 45500, discount: 0, total: 45500, paymentMethod: 'cash', status: 'voided' },
]
const staleLocalSales = Array.from({ length: 6 }, (_, index) => ({ id: `stale-${index}`, businessDate, total: 9750, paymentMethod: 'cash' }))
const days = [{ id: dayId, operationalDayId: dayId, businessDate, status: 'closed' }]

assert.equal(isReportableSale({ status: 'draft' }), false)
const rows = getReportSalesForPeriod({ localSales: [...staleLocalSales, ...centralSales], centralSales, operationalDays: days, from: businessDate, to: businessDate })
assert.equal(rows.length, 33)
assert.equal(rows.reduce((sum, row) => sum + Number(row.subtotal ?? row.total), 0), 345000)
assert.equal(rows.reduce((sum, row) => sum + Number(row.discount || 0), 0), 15490)
assert.equal(rows.reduce((sum, row) => sum + Number(row.total || 0), 0), 329510)

const comprehensive = calculateComprehensiveSummary(rows, [{ amount: 190000 }])
assert.equal(comprehensive.grossSales, 345000)
assert.equal(comprehensive.netAfterDiscount, 329510)
assert.equal(comprehensive.electronicSales, 32510)

const settlement = calculateSettlement({ sales: rows, expenses: [{ amount: 190000 }], transactions: [{ type: 'withdrawal', amount: 12000 }] })
assert.deepEqual({ orderCount: settlement.orderCount, sales: settlement.sales, cashSales: settlement.cashSales, electronicSales: settlement.electronicSales, expectedCash: settlement.expectedCash }, { orderCount: 33, sales: 329510, cashSales: 297000, electronicSales: 32510, expectedCash: 95000 })
console.log('CLOSED_DAY_REPORT_REGRESSION=PASS')
