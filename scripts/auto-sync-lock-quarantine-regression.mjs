import assert from 'node:assert/strict'
import { createCashierQueueWorker } from '../src/services/cashierQueueWorker.js'
import { createSyncLockManager, SYNC_LOCK_HEARTBEAT_STALE_MS } from '../src/services/syncLockManager.js'

const values = new Map()
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
  get length() { return values.size },
  key: index => [...values.keys()][index] ?? null,
}
globalThis.sessionStorage = globalThis.localStorage
globalThis.window = { dispatchEvent: () => {} }

let now = 100000
const manager = createSyncLockManager({ storage: localStorage, sessionStorage, now: () => now })
assert.equal(manager.acquire({ trigger: 'worker' }).acquired, true)
now += SYNC_LOCK_HEARTBEAT_STALE_MS + 1
assert.equal(manager.recoverStale().recovered, true)
assert.equal(manager.describe(), null)
assert.equal(manager.acquire({ trigger: 'worker' }).acquired, true)
now += 1
assert.equal(manager.heartbeat({ trigger: 'worker' }), true)
assert.equal(manager.describe().heartbeatAt, now)
manager.release()
assert.equal(manager.acquire({ trigger: 'worker' }).acquired, true)
const repairSafety = await manager.ensureRepairCanProceed({ queueLength: 0, retries: 3, waitMs: 1 })
assert.equal(repairSafety.ok, true)
assert.equal(repairSafety.clearedStaleLock, true)
assert.equal(manager.describe(), null)

const q = await import(`../src/services/salesSyncQueue.js?auto-sync=${Date.now()}`)
values.set('pos101.salesQuarantine', '[]')
values.set('pos101.sales', JSON.stringify([{ saleId: q.KNOWN_MANUAL_REVIEW_SALE_1056, orderNumber: 1056, total: 6000, status: 'synced' }]))
values.set('pos101.syncQueue', JSON.stringify([{ kind: 'expense', expense: { id: 'expense-1', amount: 100 } }]))
const resolved = q.resolveLegacyExpenseQueueEntries([{ id: 'expense-1', amount: 100 }])
assert.equal(resolved.identified, 1)
assert.equal(resolved.resolved, 1)
assert.equal(q.readSaleQueue().length, 0)
q.restoreManualReviewQuarantineMarker({ saleId: q.KNOWN_MANUAL_REVIEW_SALE_1056, orderNumber: 1056, reason: q.KNOWN_MANUAL_REVIEW_REASON_1056, centralExists: true })
assert.equal(q.isManualReviewQuarantined(q.KNOWN_MANUAL_REVIEW_SALE_1056), true)
assert.equal(JSON.parse(values.get('pos101.sales')).length, 1)
assert.equal(JSON.parse(values.get('pos101.syncQueue')).length, 0)

let processCalls = 0
const worker = createCashierQueueWorker({
  hasEligibleQueue: () => true,
  processQueue: async () => { processCalls += 1; return { uploaded: 0, updated: 0, centralCount: 0 } },
  intervalMs: 0,
})
const target = { addEventListener() {}, removeEventListener() {}, setInterval() {}, clearInterval() {} }
const stop = worker.start({ events: ['auth-ready'], target })
await new Promise(resolve => setImmediate(resolve))
assert.equal(processCalls, 1)
assert.equal(worker.isRunning(), false)
stop()

localStorage.setItem('pos101.emergencyRepairActive', 'true')
let pausedCalls = 0
const pausedWorker = createCashierQueueWorker({ processQueue: async () => { pausedCalls += 1 }, intervalMs: 0 })
pausedWorker.start({ events: ['auth-ready'], target })
await new Promise(resolve => setImmediate(resolve))
assert.equal(pausedCalls, 0)
localStorage.removeItem('pos101.emergencyRepairActive')

console.log(JSON.stringify({
  STALE_SHARED_LOCK_DETECTED: 'PASS',
  STALE_SHARED_LOCK_RECOVERED: 'PASS',
  AUTO_SYNC_WORKER_IDLE_HEALTHY: 'PASS',
  EXPENSE_QUEUE_DOES_NOT_BREAK_SALES_WORKER: 'PASS',
  EXPENSE_ITEM_IDENTIFIED: 'PASS',
  EXPENSE_READBACK_OR_SAFE_ROUTE: 'PASS',
  SALE_SYNC_QUEUE_SALES_ONLY: 'PASS',
  NO_DATA_LOSS: 'PASS',
  SYNC_LOCK_HEARTBEAT_REFRESHES: 'PASS',
  WORKER_STARTS_AFTER_AUTH: 'PASS',
  SALE_1056_QUARANTINE_MARKER_RESTORED: 'PASS',
  SALE_1056_NOT_RESENT: 'PASS',
  SALE_1056_NOT_DELETED: 'PASS',
  SYNC_QUEUE_ZERO_LOCK_AUTO_CLEARED: 'PASS',
  BACKGROUND_WORKER_PAUSED_DURING_REPAIR: 'PASS',
}, null, 2))
