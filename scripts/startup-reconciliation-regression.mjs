import assert from 'node:assert/strict'
import { reconcilePreCloseSales } from '../src/services/preCloseReconciliation.js'

const store = new Map()
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) }
globalThis.window = { dispatchEvent: () => {} }
const queue = await import(`../src/services/salesSyncQueue.js?startup=${Date.now()}`)
const day = { id: 'day-2026-10-07', businessDate: '2026-10-07', status: 'open' }
const sale = id => ({ saleId: id, operationKey: `pos101:${id}`, orderNumber: id, businessDate: day.businessDate, operationalDayId: day.id, status: 'completed', syncStatus: 'pending', total: 1000, discount: 0, paymentMethod: 'cash', items: [{ id: 'coffee', quantity: 1, price: 1000 }] })
const central = local => ({ ...local, status: null, syncStatus: null })

queue.enqueueSale(sale('restart-sale'))
assert.equal(queue.readPendingSaleCount(), 1)
const first = queue.reconcileSalesAgainstCentral([central(sale('restart-sale'))])
assert.equal(first.reconciled, 1)
assert.equal(queue.readPendingSaleCount(), 0)
assert.equal(JSON.parse(store.get('pos101.sales'))[0].centralVerified, true)
assert.equal(queue.readSaleQueue().length, 0)

const reloaded = await import(`../src/services/salesSyncQueue.js?startup-reload=${Date.now()}`)
assert.equal(reloaded.readPendingSaleCount(), 0)
assert.equal(reloaded.reconcileSalesAgainstCentral([central(sale('restart-sale'))]).reconciled, 0)

store.set('pos101.sales', '[]')
store.set('pos101.syncQueue', '[]')
const verified = Array.from({ length: 11 }, (_, index) => sale(`verified-${index}`))
const missing = sale('missing-sale')
for (const row of [...verified, missing]) reloaded.enqueueSale(row)
const mixed = reconcilePreCloseSales({ localSales: [...verified, missing], queueEntries: [...verified, missing].map(row => ({ sale: row })), centralSales: verified.map(central), operationalDay: day })
assert.equal(mixed.pendingQueue, 1)
assert.equal(mixed.allowed, false)
assert.equal(mixed.missingLocal[0].saleId, 'missing-sale')

const legacyComplete = central(sale('legacy-null-status'))
const legacyResult = reconcilePreCloseSales({ localSales: [sale('legacy-null-status')], queueEntries: [{ sale: sale('legacy-null-status') }], centralSales: [legacyComplete], operationalDay: day })
assert.equal(legacyResult.allowed, true)

console.log('STARTUP_RECONCILIATION=PASS')
console.log('CENTRAL_VERIFICATION_PERSISTS_LOCALLY=PASS')
console.log('CENTRAL_VERIFIED_NO_RESEND=PASS')
console.log('FALSE_PENDING_AFTER_RESTART=PASS')
console.log('MULTI_SALE_RESTART_RECONCILIATION=PASS')
console.log('ONLY_REAL_PENDING_BLOCKS=PASS')
console.log('NULL_STATUS_COMPLETE_CENTRAL_ACCEPTED=PASS')
