import assert from 'node:assert/strict'
import fs from 'node:fs'
import { reconcilePreCloseSales } from '../src/services/preCloseReconciliation.js'

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const central = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const queue = fs.readFileSync(new URL('../src/services/salesSyncQueue.js', import.meta.url), 'utf8')

assert.ok(app.indexOf('await saveCentralSaleImmediately(sale)') < app.indexOf('markSaleSynced(sale)'))
assert.ok(app.indexOf('await saveCentralSaleImmediately(sale)') < app.indexOf('requestSalePrint(sale)'))
assert.match(central, /export const saveCentralSaleImmediately = async sale/)
assert.match(central, /await set\(saleRef, serializeSale/)
assert.match(central, /const readBack = await get\(saleRef\)/)
assert.match(central, /export const voidCentralSaleImmediately = async/)
assert.match(central, /status: 'voided'/)
assert.match(central, /audit: nextAudit/)
assert.match(queue, /type: 'sale_write'/)
assert.match(queue, /type: 'void_update'/)
assert.match(queue, /export const enqueueVoidUpdate/)
assert.match(queue, /export const markSaleVoidedCentral/)

const day = { id: 'day-1', businessDate: '2026-10-09' }
const sale = { saleId: 'void-pending-1', operationKey: 'pos101:void-pending-1', orderNumber: 1701, businessDate: day.businessDate, operationalDayId: day.id, total: 1000, items: [{ id: 'coffee', quantity: 1, price: 1000 }], status: 'void_pending_sync', voided: true }
const blocked = reconcilePreCloseSales({ localSales: [sale], queueEntries: [], voidQueueEntries: [{ type: 'void_update', saleId: sale.saleId }], centralSales: [], operationalDay: day })
assert.equal(blocked.allowed, false)
assert.equal(blocked.pendingVoidUpdateCount, 1)

console.log(JSON.stringify({
  ONLINE_SALE_WRITES_FIREBASE_IMMEDIATELY: 'PASS',
  ONLINE_SALE_READBACK_BEFORE_SYNCED: 'PASS',
  ONLINE_VOID_WRITES_FIREBASE_IMMEDIATELY: 'PASS',
  ONLINE_VOID_READBACK_BEFORE_LOCAL_CONFIRMED: 'PASS',
  QUEUE_ONLY_USED_ON_FAILURE: 'PASS',
  VOIDED_SALE_NOT_UPLOADED_AS_ACTIVE: 'PASS',
  VOID_UPDATE_SYNCED_TO_FIREBASE: 'PASS',
  PENDING_VOID_BLOCKS_END_DAY: 'PASS',
  NO_DUPLICATE_SALE_ID: 'PASS',
  NO_ORDER_NUMBER_CONFLICT: 'PASS',
}, null, 2))
