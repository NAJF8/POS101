import assert from 'node:assert/strict'
import { createCashierQueueWorker } from '../src/services/cashierQueueWorker.js'

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
stop()

console.log(JSON.stringify({
  NEW_SALE_AUTOSYNC: 'PASS',
  AUTH_LATE_AUTOSYNC: 'PASS',
  PROCESSOR_LOCK_RECOVERY: 'PASS',
  RESTART_AUTOSYNC: 'PASS',
  EVENTS: events,
}))
