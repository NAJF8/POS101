import assert from 'node:assert/strict'
import { buildEndDayDiagnostic } from '../src/services/endDayDiagnostic.js'

const day = { id: 'day-2026-10-07', businessDate: '2026-10-07', status: 'open' }
const local = {
  saleId: 'sale-1282', id: 'sale-1282', orderNumber: 1282, operationKey: 'pos101:sale-1282',
  businessDate: day.businessDate, operationalDayId: day.id, status: 'completed', syncStatus: 'pending',
  total: 12000, discount: 0, paymentMethod: 'cash', items: [{ id: 'coffee', quantity: 1, price: 12000 }],
}
const central = { ...local, paymentMethod: 'electronic', syncStatus: 'synced', status: 'completed' }
const queueEntry = { kind: 'sale', queueKey: local.saleId, operationType: 'sale', sale: local, saleId: local.saleId, businessDate: day.businessDate, operationalDayId: day.id }

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => { throw new Error('DIAGNOSTIC_WRITE_DETECTED') },
  removeItem: () => { throw new Error('DIAGNOSTIC_DELETE_DETECTED') },
}

const result = buildEndDayDiagnostic({
  localSales: [local],
  queueEntries: [queueEntry],
  centralSales: [central],
  operationalDay: day,
  localOperationalDay: day,
  centralOperationalDay: day,
  openOrderCount: 0,
  preCloseGuard: { state: 'real-pending', message: 'توجد مبيعات مكتملة غير متزامنة.', loading: false },
})

assert.equal(result.pendingQueue, 1)
assert.equal(result.blockers.length, 1)
assert.equal(result.blockers[0].source, 'BOTH')
assert.equal(result.blockers[0].centralExists, true)
assert.equal(result.blockers[0].salePayloadMatches, false)
assert.deepEqual(result.blockers[0].mismatchFields, ['paymentMethod'])
assert.equal(result.blockers[0].queueEntryExists, true)

console.log('DIAGNOSTIC_READ_ONLY=PASS')
console.log('DIAGNOSTIC_BLOCKER_VISIBLE=PASS')
console.log('DIAGNOSTIC_MISMATCH_FIELDS=PASS')
console.log('DIAGNOSTIC_NO_WRITES=PASS')
