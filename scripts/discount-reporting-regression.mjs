import assert from 'node:assert/strict'
import fs from 'node:fs'
import { actualCashDiscountOf, getReportSalesForPeriod, normalizeSale } from '../src/services/reportSales.js'
import { buildDeliveryDiscountReport, deliverySourceLabel, deliverySourceOf } from '../src/services/deliveryDiscountReport.js'
import { calculateComprehensiveSummary } from '../src/services/comprehensiveReport.js'
import { buildShiftReport, buildEndDayShiftReport } from '../src/services/shiftReports.js'

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

// ==============================================================================
// TEST 1 — Normal percentage discount
// subtotal = 100,000, discount = 10%, expected cash discount = 10,000
// ==============================================================================
const normalPercentSale = sale('s-norm-pct', {
  subtotal: 100_000,
  discount: 10_000,
  discountDetails: { kind: 'percent', input: 10, value: 10_000 },
  total: 90_000,
  order: { orderType: 'داخل الكوفي', discount: { kind: 'percent', input: 10, value: 10_000 } },
})
assert.equal(actualCashDiscountOf(normalPercentSale), 10_000, 'Test 1: actualCashDiscountOf should be 10,000')
const compT1 = calculateComprehensiveSummary([normalPercentSale])
assert.equal(compT1.grossSales, 100_000, 'Test 1: grossSales')
assert.equal(compT1.discounts, 10_000, 'Test 1: discounts')
assert.equal(compT1.netAfterDiscount, 90_000, 'Test 1: netAfterDiscount')

// Fallback when stored value is undefined but kind/input exist on subtotal:
const normalPercentNoValue = sale('s-norm-noval', {
  subtotal: 100_000,
  discount: undefined,
  discountDetails: { kind: 'percent', input: 10 },
  total: 90_000,
})
assert.equal(actualCashDiscountOf(normalPercentNoValue), 10_000, 'Test 1 fallback: computes 10% of 100,000')

// ==============================================================================
// TEST 2 — Baly (using 26% default preset)
// subtotal = 100,000, discount = 26%, expected cash discount = 26,000
// orderType is 'داخل الكوفي' (real POS flow, NOT artificially set to 'بلي')
// ==============================================================================
const balySaleReal = sale('s-baly-real', {
  subtotal: 100_000,
  discount: 26_000,
  discountDetails: { kind: 'baly', input: 26, value: 26_000 },
  total: 74_000,
  order: { orderType: 'داخل الكوفي', discount: { kind: 'baly', input: 26, value: 26_000 } },
})
assert.equal(actualCashDiscountOf(balySaleReal), 26_000, 'Test 2: actualCashDiscountOf Baly')
assert.equal(deliverySourceOf(balySaleReal), 'baly', 'Test 2: deliverySourceOf must detect baly from discountDetails')
const balyReport = buildDeliveryDiscountReport([balySaleReal], { from: day, to: day })
assert.equal(balyReport.rows.length, 1, 'Test 2: Baly row must appear in delivery report')
assert.equal(balyReport.totals.baly.count, 1, 'Test 2: Baly count')
assert.equal(balyReport.totals.baly.discount, 26_000, 'Test 2: Baly discount')
assert.equal(balyReport.totals.baly.finalTotal, 74_000, 'Test 2: Baly finalTotal')
assert.equal(balyReport.totals.overall.discount, 26_000, 'Test 2: Overall delivery discount')

// ==============================================================================
// TEST 3 — Toters (using 25% default preset)
// subtotal = 100,000, discount = 25%, expected cash discount = 25,000
// orderType is 'توصيل' (real POS flow, NOT artificially set to 'توترز')
// ==============================================================================
const totersSaleReal = sale('s-toters-real', {
  subtotal: 100_000,
  discount: 25_000,
  discountDetails: { kind: 'toters', input: 25, value: 25_000 },
  total: 75_000,
  order: { orderType: 'توصيل', discount: { kind: 'toters', input: 25, value: 25_000 } },
})
assert.equal(actualCashDiscountOf(totersSaleReal), 25_000, 'Test 3: actualCashDiscountOf Toters')
assert.equal(deliverySourceOf(totersSaleReal), 'toters', 'Test 3: deliverySourceOf must detect toters from discountDetails')
const totersReport = buildDeliveryDiscountReport([totersSaleReal], { from: day, to: day })
assert.equal(totersReport.rows.length, 1, 'Test 3: Toters row must appear in delivery report')
assert.equal(totersReport.totals.toters.count, 1, 'Test 3: Toters count')
assert.equal(totersReport.totals.toters.discount, 25_000, 'Test 3: Toters discount')
assert.equal(totersReport.totals.toters.finalTotal, 75_000, 'Test 3: Toters finalTotal')

// ==============================================================================
// TEST 4 — Mixed dataset
// Sale A → no discount (subtotal 20,000, total 20,000)
// Sale B → normal discount 10,000 (subtotal 100,000, discount 10,000, total 90,000)
// Sale C → Baly discount X = 13,000 (subtotal 50,000, discount 13,000, total 37,000)
// Sale D → Toters discount Y = 10,000 (subtotal 40,000, discount 10,000, total 30,000)
// Sale E → no discount (subtotal 15,000, total 15,000)
// Expected total cash discount = 10,000 + 13,000 + 10,000 = 33,000
// ==============================================================================
const saleA = sale('sale-A', { subtotal: 20_000, discount: 0, total: 20_000 })
const saleB = sale('sale-B', { subtotal: 100_000, discount: 10_000, discountDetails: { kind: 'amount', input: 10_000, value: 10_000 }, total: 90_000 })
const saleC = sale('sale-C', { subtotal: 50_000, discount: 13_000, discountDetails: { kind: 'baly', input: 26, value: 13_000 }, total: 37_000, order: { orderType: 'داخل الكوفي' } })
const saleD = sale('sale-D', { subtotal: 40_000, discount: 10_000, discountDetails: { kind: 'toters', input: 25, value: 10_000 }, total: 30_000, order: { orderType: 'توصيل' } })
const saleE = sale('sale-E', { subtotal: 15_000, discount: 0, total: 15_000 })
const mixedSales = [saleA, saleB, saleC, saleD, saleE]

const expectedTotalDiscount = 10_000 + 13_000 + 10_000 // 33,000
const expectedGross = 20_000 + 100_000 + 50_000 + 40_000 + 15_000 // 225,000
const expectedNet = 20_000 + 90_000 + 37_000 + 30_000 + 15_000 // 192,000

// 4.1 Comprehensive Report
const mixedComp = calculateComprehensiveSummary(mixedSales)
assert.equal(mixedComp.discounts, expectedTotalDiscount, 'Test 4 Comprehensive: discounts must be 33,000')
assert.equal(mixedComp.grossSales, expectedGross, 'Test 4 Comprehensive: grossSales must be 225,000')
assert.equal(mixedComp.netAfterDiscount, expectedNet, 'Test 4 Comprehensive: netAfterDiscount must be 192,000')

// 4.2 Shift Report (Daily)
const mixedDaily = buildShiftReport({ sales: mixedSales, businessDate: day, operationalDayId: 'day-10', shiftType: 'morning' })
assert.equal(mixedDaily.discounts, expectedTotalDiscount, 'Test 4 Daily Shift: discounts must be 33,000')
assert.equal(mixedDaily.totalSales, expectedNet, 'Test 4 Daily Shift: totalSales must be net 192,000')

// 4.3 End of Day Shift Report
const mixedEndDay = buildEndDayShiftReport({ sales: mixedSales, businessDate: day, operationalDayId: 'day-10' })
assert.equal(mixedEndDay.discounts, expectedTotalDiscount, 'Test 4 EndDay: discounts must be 33,000')

// 4.4 Delivery Discounts Report
const mixedDelivery = buildDeliveryDiscountReport(mixedSales, { from: day, to: day })
assert.equal(mixedDelivery.totals.baly.discount, 13_000, 'Test 4 Delivery: Baly discount')
assert.equal(mixedDelivery.totals.toters.discount, 10_000, 'Test 4 Delivery: Toters discount')
assert.equal(mixedDelivery.totals.overall.discount, 23_000, 'Test 4 Delivery: Overall delivery discount (13,000 + 10,000)')

// ==============================================================================
// TEST 5 — No double count
// sale.discount and sale.discountDetails.value represent the same discount
// ==============================================================================
const doubleCountCandidate = sale('dc-1', {
  subtotal: 50_000,
  discount: 10_000,
  discountDetails: { kind: 'percent', input: 20, value: 10_000 },
  order: { discount: { kind: 'percent', input: 20, value: 10_000 } },
  total: 40_000,
})
assert.equal(actualCashDiscountOf(doubleCountCandidate), 10_000, 'Test 5: must return exactly 10,000, NEVER 20,000 or 30,000')
const doubleCountComp = calculateComprehensiveSummary([doubleCountCandidate])
assert.equal(doubleCountComp.discounts, 10_000, 'Test 5 Comprehensive: discounts must be 10,000')
assert.equal(doubleCountComp.grossSales, 50_000, 'Test 5 Comprehensive: grossSales must be 50,000')
assert.equal(doubleCountComp.netAfterDiscount, 40_000, 'Test 5 Comprehensive: net must be 40,000')

// When discount is 0 on top-level but discountDetails has real discount:
const zeroTopDiscount = sale('dc-2', {
  subtotal: 50_000,
  discount: 0,
  discountDetails: { kind: 'baly', input: 26, value: 13_000 },
  total: 37_000,
})
assert.equal(actualCashDiscountOf(zeroTopDiscount), 13_000, 'Test 5 fallback: must find positive value in discountDetails')

// ==============================================================================
// TEST 6 — Daily: distribute sales across multiple business dates
// ==============================================================================
const day1Sales = [
  sale('d1-1', { businessDate: '2026-11-01', discount: 5_000, total: 20_000, subtotal: 25_000 }),
]
const day2Sales = [
  sale('d2-1', { businessDate: '2026-11-02', discount: 6_000, total: 24_000, subtotal: 30_000 }),
  sale('d2-2', { businessDate: '2026-11-02', discount: 4_000, discountDetails: { kind: 'baly', input: 26, value: 4_000 }, total: 16_000, subtotal: 20_000 }),
]
const day3Sales = [
  sale('d3-1', { businessDate: '2026-11-03', discount: 7_000, discountDetails: { kind: 'toters', input: 25, value: 7_000 }, total: 21_000, subtotal: 28_000 }),
]
const multiDaySales = [...day1Sales, ...day2Sales, ...day3Sales]

const shiftD1 = buildShiftReport({ sales: multiDaySales, businessDate: '2026-11-01', shiftType: 'morning' })
assert.equal(shiftD1.discounts, 5_000, 'Test 6: Day 1 discounts must be 5,000')

const shiftD2 = buildShiftReport({ sales: multiDaySales, businessDate: '2026-11-02', shiftType: 'morning' })
assert.equal(shiftD2.discounts, 10_000, 'Test 6: Day 2 discounts must be 10,000 (6,000 + 4,000)')

const shiftD3 = buildShiftReport({ sales: multiDaySales, businessDate: '2026-11-03', shiftType: 'morning' })
assert.equal(shiftD3.discounts, 7_000, 'Test 6: Day 3 discounts must be 7,000')

// ==============================================================================
// TEST 7 — Monthly / Period: sum(daily discounts) === period discounts
// 1/11 → 5,000
// 2/11 → 10,000
// 3/11 → 7,000
// Expected Period Total = 22,000 (no duplicate aggregation)
// ==============================================================================
const periodSales = getReportSalesForPeriod({
  centralSales: multiDaySales,
  from: '2026-11-01',
  to: '2026-11-03',
})
assert.equal(periodSales.length, 4, 'Test 7: 4 sales across the period')

const dailyMap = new Map()
periodSales.forEach(s => {
  const d = s.businessDate
  dailyMap.set(d, (dailyMap.get(d) || 0) + actualCashDiscountOf(s))
})
assert.equal(dailyMap.get('2026-11-01'), 5_000, 'Test 7 daily: 1/11 -> 5,000')
assert.equal(dailyMap.get('2026-11-02'), 10_000, 'Test 7 daily: 2/11 -> 10,000')
assert.equal(dailyMap.get('2026-11-03'), 7_000, 'Test 7 daily: 3/11 -> 7,000')

const sumDaily = [...dailyMap.values()].reduce((sum, v) => sum + v, 0)
const totalPeriodDiscount = periodSales.reduce((sum, s) => sum + actualCashDiscountOf(s), 0)
assert.equal(totalPeriodDiscount, 22_000, 'Test 7: Total period discount must be 22,000')
assert.equal(sumDaily, totalPeriodDiscount, 'Test 7: sum(daily discounts) must strictly equal totalPeriodDiscount')

// Test deduplication across local and central:
const duplicatedFetch = getReportSalesForPeriod({
  localSales: multiDaySales,
  centralSales: multiDaySales,
  from: '2026-11-01',
  to: '2026-11-03',
})
assert.equal(duplicatedFetch.length, 4, 'Test 7 dedup: duplicate sales across local and central must not be multiplied')
assert.equal(duplicatedFetch.reduce((sum, s) => sum + actualCashDiscountOf(s), 0), 22_000, 'Test 7 dedup: discounts stay 22,000')

// ==============================================================================
// TEST 8 — Comprehensive report: discount remains Discount, not Gift
// ==============================================================================
const discountNotGiftSale = sale('s-comp-gift-check', {
  subtotal: 50_000,
  discount: 15_000,
  total: 35_000,
  items: [{ id: '1', name: 'قهوة مختصة', price: 25_000, quantity: 2 }],
})
const compGiftCheck = calculateComprehensiveSummary([discountNotGiftSale])
assert.equal(compGiftCheck.discounts, 15_000, 'Test 8: discount must be recorded as discounts')
assert.equal(compGiftCheck.grossSales, 50_000, 'Test 8: product value must be in gross sales')
assert.equal(compGiftCheck.netAfterDiscount, 35_000, 'Test 8: net sale after discount')

// Ensure source code has no gift logic tied to discounts
const reportsSource = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
assert.doesNotMatch(reportsSource, /if \(sale\.discount && sale\.discount > 0\)/, 'Test 8: must not classify discounted sales as gifts')
assert.doesNotMatch(reportsSource, /تقرير مبيعات الهديا/, 'Test 8: no gift sales report tied to discounts')

// ==============================================================================
// POS Screen Display Test: OrderPanel displays "الخصومات" with cash format
// ==============================================================================
const panelSource = fs.readFileSync(new URL('../src/components/OrderPanel.jsx', import.meta.url), 'utf8')
assert.match(panelSource, /<span className="label">الخصومات<\/span>/, 'OrderPanel must display "الخصومات"')
assert.match(panelSource, /\{formatNumber\(discountVal\)\} <small>د\.ع<\/small>/, 'OrderPanel must format cash amount with د.ع')
assert.match(panelSource, /const discountVal = safeNumber\(discount \?\? order\?\.discount\?\.value, 0\)/, 'OrderPanel must handle discount fallback')

console.log('ALL_DISCOUNT_REPORTING_REGRESSION_TESTS=PASS')
