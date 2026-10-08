// Shared cross-tab lock for POS101 sale synchronization.
// Storage key: pos101.syncLock (localStorage). It is coordination metadata
// only; it never contains sale payloads and is never used to delete queue data.
export const SYNC_LOCK_KEY = 'pos101.syncLock'
export const SYNC_LOCK_VERSION = 1
export const SYNC_LOCK_STALE_MS = 60 * 1000
export const SYNC_LOCK_HEARTBEAT_STALE_MS = 30 * 1000

const randomId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
const read = storage => {
  try {
    const value = JSON.parse(storage?.getItem?.(SYNC_LOCK_KEY) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch { return null }
}
const write = (storage, value) => storage?.setItem?.(SYNC_LOCK_KEY, JSON.stringify(value))
const remove = storage => storage?.removeItem?.(SYNC_LOCK_KEY)
const ageOf = (now, value) => Math.max(0, now - Number(value || 0))

export const createSyncLockManager = ({ storage = globalThis.localStorage, sessionStorage = globalThis.sessionStorage, now = () => Date.now() } = {}) => {
  let ownerId = randomId('sync-owner')
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

  return { acquire, heartbeat, release, recoverStale, describe, ownerId, tabId, deviceId }
}

export const defaultSyncLockManager = createSyncLockManager()
