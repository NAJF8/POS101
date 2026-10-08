import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createSyncLockManager, SYNC_LOCK_HEARTBEAT_STALE_MS, SYNC_LOCK_STALE_MS } from '../src/services/syncLockManager.js'

const values = new Map()
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
}
let now = 1000
const manager = createSyncLockManager({ storage, sessionStorage: storage, now: () => now })
assert.equal(manager.acquire({ trigger: 'worker' }).acquired, true)
now += SYNC_LOCK_HEARTBEAT_STALE_MS + 1
assert.equal(manager.recoverStale().recovered, true)
assert.equal(manager.describe(), null)

const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
assert.match(sync, /if \(activeSaleSyncPromise\) return activeSaleSyncPromise/)
assert.match(sync, /QUEUE_ITEM_DIAGNOSTIC/)
assert.match(sync, /markSaleSynced\(sale\)/)
const uploadPath = sync.indexOf('const saleRef = ref(db, `pos101_sales/${saleIdOf(sale)}`)')
assert.ok(uploadPath >= 0)
assert.ok(sync.indexOf('const readBack = await get(saleRef)', uploadPath) < sync.indexOf('markSaleSynced(sale)', uploadPath))

console.log(JSON.stringify({
  LOCK_SELF_BLOCK_REGRESSION: 'PASS',
  MANUAL_RECOVERY_DOES_NOT_BLOCK_ITSELF: 'PASS',
  STALE_BLOCKED_ACTIVE_LOCK_CLEARED: 'PASS',
  READBACK_BEFORE_SYNCED: 'PASS',
}, null, 2))
