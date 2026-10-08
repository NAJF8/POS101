import assert from 'node:assert/strict'
import { buildDeliveryDiscountReport, deliverySourceOf } from '../src/services/deliveryDiscountReport.js'

const sales = [
  { id: 'b1', orderNumber: 1, businessDate: '2026-10-08', orderType: 'Baly', subtotal: 10000, discount: 2600, total: 7400, paymentMethod: 'cash', createdAt: 1 },
  { id: 't1', orderNumber: 2, businessDate: '2026-10-08', order: { orderType: 'توترز' }, subtotal: 20000, discount: 5000, total: 15000, paymentMethod: 'electronic', createdAt: 2 },
  { id: 'v1', orderNumber: 3, businessDate: '2026-10-08', source: 'Baly', status: 'voided', subtotal: 1, discount: 1, total: 0, createdAt: 3 },
]
assert.equal(deliverySourceOf(sales[0]), 'baly')
const report = buildDeliveryDiscountReport(sales, { from: '2026-10-08', to: '2026-10-08' })
assert.equal(report.rows.length, 2)
assert.equal(report.totals.baly.discount, 2600)
assert.equal(report.totals.toters.finalTotal, 15000)
assert.equal(report.totals.overall.count, 2)
console.log('DELIVERY_DISCOUNT_REPORT_REGRESSION=PASS')
