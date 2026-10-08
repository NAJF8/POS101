// Shared cross-tab lock for POS101 sale synchronization.
// Storage key: pos101.syncLock (localStorage). It is coordination metadata
// only; it never contains sale payloads and is never used to delete queue data.
export const SYNC_LOCK_KEY = 'pos101.syncLock'
export const SYNC_LOCK_VERSION = 1
export const SYNC_LOCK_STALE_MS = 60 * 1000
export const SYNC_LOCK_HEARTBEAT_STALE_MS = 30 * 1000
export const REPAIR_LOCK_KEY = 'pos101.repairLock'
export const EMERGENCY_REPAIR_KEY = 'pos101.emergencyRepairActive'

const randomId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
const read = storage => {
  try {
    const value = JSON.parse(storage?.getItem?.(SYNC_LOCK_KEY) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch { return null }
}
const write = (storage, value) => storage?.setItem?.(SYNC_LOCK_KEY, JSON.stringify(value))
const remove = storage => storage?.removeItem?.(SYNC_LOCK_KEY)
const readRepair = storage => {
  try {
    const value = JSON.parse(storage?.getItem?.(REPAIR_LOCK_KEY) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch { return null }
}
const ageOf = (now, value) => Math.max(0, now - Number(value || 0))

export const createSyncLockManager = ({ storage = globalThis.localStorage, sessionStorage = globalThis.sessionStorage, now = () => Date.now() } = {}) => {
  let ownerId = randomId('sync-owner')
  const repairOwnerId = randomId('repair-owner')
  let tabId = ''
  try {
    tabId = sessionStorage?.getItem?.('pos101.syncTabId') || randomId('tab')
    sessionStorage?.setItem?.('pos101.syncTabId', tabId)
  } catch { tabId = randomId('tab') }
  let deviceId = ''
  try { deviceId = storage?.getItem?.('pos101.deviceId') || '' } catch {}

  const describe = () => {
    const lock = read(storage)
    if (!lock) return null
    return {
      ...lock,
      lockAgeSeconds: Math.floor(ageOf(now(), lock.startedAt) / 1000),
      heartbeatAgeSeconds: Math.floor(ageOf(now(), lock.heartbeatAt) / 1000),
      ownedByThisContext: lock.ownerId === ownerId,
    }
  }

  const isStale = lock => Boolean(lock && (
    ageOf(now(), lock.startedAt) > SYNC_LOCK_STALE_MS
    || ageOf(now(), lock.heartbeatAt) > SYNC_LOCK_HEARTBEAT_STALE_MS
  ))

  const recoverStale = () => {
    const before = describe()
    if (!isStale(before)) return { recovered: false, before }
    const current = read(storage)
    if (!current || current.ownerId !== before.ownerId || current.heartbeatAt !== before.heartbeatAt) {
      return { recovered: false, before: describe(), raced: true }
    }
    remove(storage)
    return { recovered: !read(storage), before }
  }

  const acquire = ({ trigger = 'manual', processingSaleIds = [], hasPendingQueue = false } = {}) => {
    const before = describe()
    if (before) {
      const stale = isStale(before)
      // Lock data is coordination metadata only. A stale lock can therefore
      // always be released safely, including when the queue is currently
      // empty or malformed.
      if (!stale) return { acquired: false, action: 'blocked_active', before }
      remove(storage)
    }
    const timestamp = now()
    const lock = {
      ownerId,
      tabId,
      deviceId,
      startedAt: timestamp,
      heartbeatAt: timestamp,
      trigger,
      processingSaleIds: [...processingSaleIds],
      version: SYNC_LOCK_VERSION,
    }
    write(storage, lock)
    const confirmed = describe()
    if (!confirmed || confirmed.ownerId !== ownerId) return { acquired: false, action: 'blocked_active', before: confirmed || before }
    return { acquired: true, action: before ? 'released_stale' : 'acquired', before, lock: confirmed }
  }

  const heartbeat = ({ processingSaleIds = [], trigger } = {}) => {
    const current = read(storage)
    if (!current || current.ownerId !== ownerId) return false
    write(storage, { ...current, heartbeatAt: now(), trigger: trigger || current.trigger, processingSaleIds: [...processingSaleIds] })
    return true
  }

  const release = () => {
    const current = read(storage)
    if (current?.ownerId !== ownerId) return false
    remove(storage)
    return true
  }

  const ensureRepairCanProceed = async ({ queueLength = 0, retries = 3, waitMs = 250 } = {}) => {
    const lockBefore = describe()
    if (!lockBefore) return { ok: true, clearedStaleLock: false, lockBefore: null, lockAfter: null, reason: 'NO_LOCK' }
    if (Number(queueLength) === 0 || isStale(lockBefore)) {
      const recovered = recoverStale()
      if (Number(queueLength) === 0 && describe()) remove(storage)
      const lockAfter = describe()
      return { ok: !lockAfter, clearedStaleLock: Boolean(recovered.recovered || !lockAfter), lockBefore, lockAfter, reason: lockAfter ? 'LOCK_CHANGED_DURING_CLEAR' : (Number(queueLength) === 0 ? 'EMPTY_QUEUE_LOCK_CLEARED' : 'STALE_LOCK_CLEARED') }
    }
    for (let attempt = 0; attempt < Math.max(1, retries); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, waitMs))
      const current = describe()
      if (!current) return { ok: true, clearedStaleLock: false, lockBefore, lockAfter: null, reason: 'LOCK_FINISHED' }
      if (isStale(current)) {
        const recovered = recoverStale()
        const lockAfter = describe()
        return { ok: !lockAfter, clearedStaleLock: Boolean(recovered.recovered), lockBefore, lockAfter, reason: lockAfter ? 'LOCK_CHANGED_DURING_CLEAR' : 'STALE_LOCK_CLEARED_AFTER_RETRY' }
      }
    }
    return { ok: false, clearedStaleLock: false, lockBefore, lockAfter: describe(), reason: `ACTIVE_LOCK_AFTER_${Math.max(1, retries)}_RETRIES` }
  }

  const acquireRepairLock = () => {
    const existing = readRepair(storage)
    if (existing && existing.ownerId !== repairOwnerId && ageOf(now(), existing.startedAt) <= SYNC_LOCK_STALE_MS) return { acquired: false, lock: existing }
    const lock = { ownerId: repairOwnerId, startedAt: now(), heartbeatAt: now(), version: SYNC_LOCK_VERSION, trigger: 'one-button-repair' }
    storage?.setItem?.(REPAIR_LOCK_KEY, JSON.stringify(lock))
    const confirmed = readRepair(storage)
    return { acquired: confirmed?.ownerId === repairOwnerId, lock: confirmed }
  }

  const releaseRepairLock = () => {
    const current = readRepair(storage)
    if (current?.ownerId !== repairOwnerId) return false
    storage?.removeItem?.(REPAIR_LOCK_KEY)
    return true
  }

  // The emergency flag is a pause signal, not durable repair state. A crash,
  // tab kill, or interrupted deployment must not leave normal sale sync disabled.
  const recoverStaleEmergencyRepairFlag = () => {
    const flag = storage?.getItem?.(EMERGENCY_REPAIR_KEY)
    if (flag !== 'true') return { cleared: false, active: false, reason: 'NO_FLAG' }
    const repair = readRepair(storage)
    if (repair && ageOf(now(), repair.heartbeatAt || repair.startedAt) <= SYNC_LOCK_HEARTBEAT_STALE_MS) {
      return { cleared: false, active: true, reason: 'REPAIR_ACTIVE', repair }
    }
    if (repair) storage?.removeItem?.(REPAIR_LOCK_KEY)
    storage?.removeItem?.(EMERGENCY_REPAIR_KEY)
    if (typeof console !== 'undefined') console.info('STALE_EMERGENCY_REPAIR_FLAG_CLEARED=YES')
    return { cleared: true, active: false, reason: repair ? 'STALE_REPAIR_LOCK' : 'FLAG_WITHOUT_REPAIR_LOCK' }
  }

  return { acquire, heartbeat, release, recoverStale, describe, ensureRepairCanProceed, acquireRepairLock, releaseRepairLock, recoverStaleEmergencyRepairFlag, ownerId, tabId, deviceId }
}

export const defaultSyncLockManager = createSyncLockManager()
