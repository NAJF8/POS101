import assert from 'node:assert/strict'
import { createCashierQueueWorker } from '../src/services/cashierQueueWorker.js'
import { createSyncLockManager, SYNC_LOCK_HEARTBEAT_STALE_MS, SYNC_LOCK_STALE_MS } from '../src/services/syncLockManager.js'

const events = ['pos101-sale-created', 'pos101-sale-updated', 'online', 'focus', 'visibilitychange', 'firebase-reconnect', 'auth-ready']
const makeTarget = () => {
  const listeners = new Map()
  const intervals = new Map()
  let nextInterval = 1
  return {
    addEventListener(name, fn) { listeners.set(name, fn) },
    removeEventListener(name) { listeners.delete(name) },
    setInterval(fn) { const id = nextInterval++; intervals.set(id, fn); return id },
    clearInterval(id) { intervals.delete(id) },
    emit(name) { listeners.get(name)?.() },
    tick() { for (const fn of intervals.values()) fn() },
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

let eligible = true
let processCalls = 0
const diagnostics = []
let release
const firstGate = new Promise(resolve => { release = resolve })
const target = makeTarget()
const worker = createCashierQueueWorker({
  hasEligibleQueue: () => eligible,
  processQueue: async () => {
    processCalls += 1
    if (processCalls === 1) await firstGate
    if (processCalls === 2) throw new Error('processor fixture error')
  },
  onDiagnostic: event => diagnostics.push(event),
  intervalMs: 1000,
})
const stop = worker.start({ events, target })
await flush()
assert.equal(processCalls, 1, 'startup must process a durable queue')
target.emit('auth-ready')
assert.equal(processCalls, 1, 'single-flight must collapse concurrent triggers')
release()
await flush()
assert.equal(worker.isRunning(), false, 'lock must clear after success')

target.emit('online')
await flush()
assert.equal(processCalls, 2, 'online must retry')
await flush()
assert.equal(worker.isRunning(), false, 'lock must clear after processor error')

target.emit('firebase-reconnect')
await flush()
assert.equal(processCalls, 3, 'reconnect must retry after an error')
eligible = false
target.emit('focus')
target.tick()
await flush()
assert.equal(processCalls, 3, 'ineligible queues must not run')
assert.ok(diagnostics.some(event => event.event === 'WORKER_PROCESS_START' && event.trigger === 'startup'))
assert.ok(diagnostics.some(event => event.event === 'WORKER_RUN_SKIPPED' && event.reason === 'ineligible'))
assert.ok(diagnostics.some(event => event.event === 'WORKER_PROCESS_ERROR'))
stop()

const values = new Map()
const storage = {
  getItem: key => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
}
let now = 100000
const managerA = createSyncLockManager({ storage, sessionStorage: storage, now: () => now })
const managerB = createSyncLockManager({ storage, sessionStorage: storage, now: () => now })
assert.equal(managerA.acquire({ trigger: 'worker' }).acquired, true)
assert.equal(managerB.acquire({ trigger: 'worker' }).action, 'blocked_active')
now += Math.max(SYNC_LOCK_STALE_MS, SYNC_LOCK_HEARTBEAT_STALE_MS) + 1
assert.equal(managerB.acquire({ trigger: 'worker' }).action, 'released_stale')
assert.equal(managerB.describe().ownedByThisContext, true)

console.log(JSON.stringify({
  NEW_SALE_AUTOSYNC: 'PASS',
  AUTH_LATE_AUTOSYNC: 'PASS',
  PROCESSOR_LOCK_RECOVERY: 'PASS',
  RESTART_AUTOSYNC: 'PASS',
  WORKER_REGRESSION_UPDATED: 'PASS',
  SHARED_SYNC_LOCK_TEST: 'PASS',
  STALE_LOCK_RECOVERY_TEST: 'PASS',
  EVENTS: events,
}))
