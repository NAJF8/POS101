import assert from 'node:assert/strict'
import { getReportSalesForPeriod } from '../src/services/reportSales.js'

const date = '2026-10-16'
const closed = { id: 'morning-closed', businessDate: date, status: 'closed' }
const open = { id: 'afternoon-open', businessDate: date, status: 'open' }
const sales = [
  { saleId: 'closed-sale', businessDate: date, operationalDayId: closed.id, total: 1000, paymentMethod: 'cash' },
  { saleId: 'open-sale', businessDate: date, operationalDayId: open.id, total: 2500, paymentMethod: 'cash' },
]
const params = { localSales: sales, centralSales: sales, operationalDays: [closed, open], from: date, to: date }
const activeRows = getReportSalesForPeriod({ ...params, currentOperationalDay: open })
assert.equal(activeRows.length, 2, 'Open date must not hide sales merely because a closed shift exists')
assert.deepEqual(new Set(activeRows.map(row => row.saleId)), new Set(['closed-sale','open-sale']))
const historicRows = getReportSalesForPeriod({ ...params, currentOperationalDay: null })
assert.deepEqual(historicRows.map(row => row.saleId), ['closed-sale', 'open-sale'])
console.log('REPORT_ACTIVE_DAY_PRIORITY=PASS')
