import assert from 'node:assert/strict'
import { filterReportSales } from '../src/services/reportSales.js'
import { getOpenOrders } from '../src/services/orderState.js'

const day = value => new Date(`${value}T12:00:00`).getTime()
const sales = Array.from({ length: 71 }, (_, index) => ({
  id: `sale-${index + 1}`,
  createdAt: day(index < 10 ? '2026-09-25' : index < 13 ? '2026-09-26' : '2026-09-28'),
  total: index + 1,
  voided: index === 13,
  paymentMethod: index % 2 ? 'electronic' : 'cash',
}))

const selected = filterReportSales(sales, { startMs: day('2026-09-25'), endMs: day('2026-09-25') + 86399999 })
assert.equal(selected.length, 10, 'date filter selects exactly 10 sales')
assert.equal(selected.reduce((sum, sale) => sum + sale.total, 0), 55, 'filtered totals use the same 10 sales')
assert.equal(filterReportSales(sales, { startMs: day('2026-09-26'), endMs: day('2026-09-26') + 86399999 }).length, 3, 'changing date uses the new dataset')
assert.equal(filterReportSales(sales, { startMs: day('2030-01-01'), endMs: day('2030-01-01') + 86399999 }).length, 0, 'zero result never falls back to all sales')
assert.equal(selected.filter(sale => sale.paymentMethod === 'cash').length, 5, 'payment scope stays within filtered dataset')

const orders = [
  { id: 1, items: [], held: false, completed: false },
  { id: 2, items: [{ quantity: 1 }], held: true, completed: false },
  { id: 3, items: [{ quantity: 2 }], held: false, completed: false },
  { id: 4, items: [{ quantity: 1 }], held: true, completed: true },
  { id: 5, items: [{ quantity: 1 }], held: true, status: 'voided' },
]
assert.deepEqual(getOpenOrders(orders).map(order => order.id), [2, 3], 'only active, non-empty orders are open')
assert.equal(getOpenOrders([{ id: 9, items: [{ quantity: 1 }], completed: true }]).length, 0, 'completed orders are excluded')
assert.equal(getOpenOrders([{ id: 10, items: [{ quantity: 1 }], status: 'cancelled' }]).length, 0, 'cancelled orders are excluded')

console.log(JSON.stringify({
  sales_report: { selected: selected.length, changed_filter: 3, zero_result: 0, payment_cash: 5 },
  open_orders: { ids: getOpenOrders(orders).map(order => order.id), dedup_scope: 'local order ids; no central write' },
  status: 'PASS',
}, null, 2))
