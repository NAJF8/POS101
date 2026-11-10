import assert from 'node:assert/strict'
import fs from 'node:fs'
import { actualCashDiscountOf, getReportSalesForPeriod } from '../src/services/reportSales.js'
import { buildDeliveryDiscountReport, deliverySourceLabel } from '../src/services/deliveryDiscountReport.js'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'
import { buildShiftReport } from '../src/services/shiftReports.js'

const day = '2026-11-10'
const sale = (id, overrides = {}) => ({
  id,
  saleId: id,
  businessDate: day,
  operationalDayId: 'day-10',
  status: 'completed',
  subtotal: 10_000,
  total: 10_000,
  discount: 0,
  paymentMethod: 'cash',
  shiftType: 'morning',
  ...overrides,
})

// The scalar is canonical; details describe the same discount and are never added.
assert.equal(actualCashDiscountOf(sale('none')), 0)
assert.equal(actualCashDiscountOf(sale('ordinary', { discount: 5_000 })), 5_000)
assert.equal(actualCashDiscountOf(sale('same-value', { discount: 9_000, discountDetails: { value: 9_000 } })), 9_000)
assert.equal(actualCashDiscountOf(sale('percent', { discount: undefined, discountDetails: { kind: 'percent', input: 10, value: 5_000 } })), 5_000)

const discountSales = [
  sale('ordinary', { discount: 2_000 }),
  sale('baly', { discount: 3_000, discountDetails: { kind: 'baly', input: 26, value: 3_000 }, orderType: 'بلي' }),
  sale('toters', { discount: 4_000, discountDetails: { kind: 'toters', input: 25, value: 4_000 }, orderType: 'توترز' }),
]
const comprehensive = calculateComprehensiveSummary(discountSales)
assert.equal(comprehensive.discounts, 9_000)
assert.equal(comprehensive.grossSales, 30_000)
assert.equal(comprehensive.netAfterDiscount, 21_000)

const daily = buildShiftReport({ sales: discountSales, businessDate: day, operationalDayId: 'day-10', shiftType: 'morning' })
assert.equal(daily.discounts, 9_000)

const delivery = buildDeliveryDiscountReport(discountSales, { from: day, to: day })
assert.equal(delivery.totals.baly.discount, 3_000)
assert.equal(delivery.totals.toters.discount, 4_000)
assert.equal(delivery.totals.overall.discount, 7_000)
assert.equal(deliverySourceLabel('baly'), 'Baly')

const ranged = getReportSalesForPeriod({
  centralSales: [...discountSales, sale('previous-day', { businessDate: '2026-11-09', discount: 99_000 })],
  from: day,
  to: day,
})
assert.deepEqual(ranged.map(row => row.id).sort(), ['baly', 'ordinary', 'toters'])
assert.equal(calculateComprehensiveSummary([sale('report-value', { subtotal: 20_000, discount: 5_000, total: 15_000 })]).discounts, 5_000)

const reportsSource = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
const panelSource = fs.readFileSync(new URL('../src/components/OrderPanel.jsx', import.meta.url), 'utf8')
assert.match(reportsSource, /إجمالي الخصومات/)
assert.match(reportsSource, /day\.discounts \+= actualCashDiscountOf\(row\)/)
assert.doesNotMatch(reportsSource, /if \(sale\.discount && sale\.discount > 0\)/)
assert.match(panelSource, /const discountVal = safeNumber\(discount, 0\)/)

console.log('DISCOUNT_REPORTING_REGRESSION=PASS')
