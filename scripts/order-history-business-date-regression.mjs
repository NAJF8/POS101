import assert from 'node:assert/strict'
import { businessDateForSale, businessDateTimestamp } from '../src/services/reportSales.js'

const sales = [
  { saleId: 'A', createdAt: '2026-09-30T23:50:00+03:00', businessDate: '2026-09-30', operationalDayId: 'DAY30' },
  { saleId: 'B', createdAt: '2026-10-01T00:23:00+03:00', businessDate: '2026-09-30', operationalDayId: 'DAY30' },
  { saleId: 'C', createdAt: '2026-10-01T02:00:00+03:00', businessDate: '2026-09-30', operationalDayId: 'DAY30' },
  { saleId: 'LEGACY', createdAt: '2026-10-01T02:30:00+03:00' },
]

const filterByBusinessDate = (items, date) => items.filter(sale => businessDateForSale(sale) === date)
assert.deepEqual(filterByBusinessDate(sales, '2026-09-30').map(sale => sale.saleId), ['A', 'B', 'C'])
assert.deepEqual(filterByBusinessDate(sales, '2026-10-01').map(sale => sale.saleId), ['LEGACY'])
assert.equal(businessDateForSale(sales[1]), '2026-09-30')
assert.equal(businessDateTimestamp(sales[1]), businessDateTimestamp({ businessDate: '2026-09-30' }))
assert.equal(sales[1].createdAt, '2026-10-01T00:23:00+03:00')

console.log('ORDER_HISTORY_BUSINESS_DATE_REGRESSION=PASS')
