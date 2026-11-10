import assert from 'node:assert/strict'
import { buildDeliveryDiscountReport, deliverySourceOf } from '../src/services/deliveryDiscountReport.js'

const sales = [
  { id: 'b1', orderNumber: 1, businessDate: '2026-10-08', orderType: 'Baly', subtotal: 10000, discount: 2600, total: 7400, paymentMethod: 'cash', createdAt: 1 },
  { id: 't1', orderNumber: 2, businessDate: '2026-10-08', order: { orderType: 'توترز' }, subtotal: 20000, discount: 5000, total: 15000, paymentMethod: 'electronic', createdAt: 2 },
  { id: 'v1', orderNumber: 3, businessDate: '2026-10-08', source: 'Baly', status: 'voided', subtotal: 1, discount: 1, total: 0, createdAt: 3 },
  // Real sales from POS where orderType is 'داخل الكوفي' or 'توصيل' and Baly/Toters is in discountDetails
  { id: 'b2-real', orderNumber: 4, businessDate: '2026-10-08', orderType: 'داخل الكوفي', discountDetails: { kind: 'baly', input: 26, value: 5200 }, subtotal: 20000, discount: 5200, total: 14800, paymentMethod: 'cash', createdAt: 4 },
  { id: 't2-real', orderNumber: 5, businessDate: '2026-10-08', orderType: 'توصيل', order: { discount: { kind: 'toters', input: 25, value: 2500 } }, subtotal: 10000, discount: 2500, total: 7500, paymentMethod: 'electronic', createdAt: 5 },
]
assert.equal(deliverySourceOf(sales[0]), 'baly')
assert.equal(deliverySourceOf(sales[3]), 'baly', 'Real POS sale with discountDetails.kind baly must be detected')
assert.equal(deliverySourceOf(sales[4]), 'toters', 'Real POS sale with order.discount.kind toters must be detected')

const report = buildDeliveryDiscountReport(sales, { from: '2026-10-08', to: '2026-10-08' })
assert.equal(report.rows.length, 4)
assert.equal(report.totals.baly.count, 2)
assert.equal(report.totals.baly.discount, 2600 + 5200)
assert.equal(report.totals.toters.count, 2)
assert.equal(report.totals.toters.discount, 5000 + 2500)
assert.equal(report.totals.toters.finalTotal, 15000 + 7500)
assert.equal(report.totals.overall.count, 4)
assert.equal(report.totals.overall.discount, 7800 + 7500)
console.log('DELIVERY_DISCOUNT_REPORT_REGRESSION=PASS')
