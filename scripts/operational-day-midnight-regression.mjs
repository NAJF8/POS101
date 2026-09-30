import assert from 'node:assert/strict'
import { calculateOperationalDaySummary, filterSalesByOperationalDay } from '../src/services/operationalDayReport.js'

const day = { id: 'DAY30', businessDate: '2026-09-30', status: 'open' }
const sales = [
  { saleId: 'A', createdAt: '2026-09-30T22:00:00+03:00', operationalDayId: 'DAY30', businessDate: '2026-09-30', total: 141000, discount: 0, paymentMethod: 'cash' },
  { saleId: 'B', createdAt: '2026-10-01T00:20:00+03:00', operationalDayId: 'DAY30', businessDate: '2026-09-30', total: 12000, discount: 0, paymentMethod: 'cash' },
  { saleId: 'C', createdAt: '2026-10-01T00:25:00+03:00', operationalDayId: 'DAY30', businessDate: '2026-09-30', total: 6000, discount: 0, paymentMethod: 'electronic' },
]

assert.equal(filterSalesByOperationalDay(sales, day.id).length, 3)
assert.equal(calculateOperationalDaySummary(sales, [], day.id).total, 159000)
assert.equal(calculateOperationalDaySummary(sales, [], day.id).cash, 153000)
assert.equal(calculateOperationalDaySummary(sales, [], day.id).electronic, 6000)
assert.equal(sales[1].createdAt, '2026-10-01T00:20:00+03:00')
assert.equal(sales[1].businessDate, day.businessDate)
console.log('OPERATIONAL_DAY_MIDNIGHT_REGRESSION=PASS')
