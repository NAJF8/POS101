export const SALES_CACHE_KEY = 'pos101.sales'
export const SALES_CACHE_MAX_ROWS = 50
export const SALES_CACHE_MAX_BYTES = 180 * 1024
export const STORAGE_PROBE_KEY = 'pos101.storageProbe'

const PROTECTED_KEYS = new Set([
  'pos101.session', 'pos101.orders', 'pos101.syncQueue', 'pos101.accSaleSyncQueue', 'pos101.salesQuarantine',
  'pos101.syncQueue.quarantine', 'pos101.deviceId', 'pos101.operationalDay', 'pos101.localOperationalDayStale',
  'pos101.localClosedByCentral', 'pos101.staleDetectedAt', 'pos101.updateReload',
])

const text = value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).trim() : ''
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const saleId = sale => text(sale?.saleId || sale?.id || sale?.operationKey || sale?.orderNumber)
const isCentralVerified = sale => sale?.centralVerified === true || sale?.syncStatus === 'synced' || sale?.status === 'synced' || Boolean(sale?.syncConfirmedAt)
const isPending = sale => !isCentralVerified(sale) && !['voided', 'cancelled', 'canceled', 'abandoned', 'draft', 'باطل', 'ملغي'].includes(text(sale?.status).toLowerCase())

export const isQuotaExceededError = error => {
  const value = `${error?.name || ''} ${error?.message || error || ''}`.toLowerCase()
  return value.includes('quota') || value.includes('exceeded the quota') || value.includes('storage') && value.includes('full')
}

export const summarizeSaleForCache = sale => ({
  saleId: text(sale?.saleId || sale?.id),
  id: text(sale?.id || sale?.saleId),
  operationKey: text(sale?.operationKey || sale?.operation_key),
  orderNumber: sale?.orderNumber ?? null,
  businessDate: text(sale?.businessDate || sale?.business_date),
  operationalDayId: text(sale?.operationalDayId || sale?.operational_day_id),
  createdAt: sale?.createdAt ?? sale?.created_at ?? null,
  cashierId: text(sale?.cashierId || sale?.shiftId),
  cashierNameSnapshot: text(sale?.cashierNameSnapshot || sale?.cashierName || sale?.seller),
  shiftType: text(sale?.shiftType),
  subtotal: number(sale?.subtotal),
  discount: number(sale?.discount),
  total: number(sale?.total ?? sale?.net_total ?? sale?.subtotal),
  paymentMethod: text(sale?.paymentMethod || sale?.payment?.method),
  itemCount: Array.isArray(sale?.items) ? sale.items.length : Array.isArray(sale?.order?.items) ? sale.order.items.length : number(sale?.itemCount),
  status: text(sale?.status || 'completed'),
  syncStatus: text(sale?.syncStatus || (isCentralVerified(sale) ? 'synced' : 'pending')),
  centralVerified: isCentralVerified(sale),
  centralVerifiedAt: sale?.centralVerifiedAt ?? null,
  syncConfirmedAt: sale?.syncConfirmedAt ?? null,
  voided: sale?.voided === true,
  voidedAt: sale?.voidedAt ?? null,
  centralUploadSkipped: sale?.centralUploadSkipped === true,
  voidCentralVerified: sale?.voidCentralVerified === true,
  queueResolution: text(sale?.queueResolution),
  audit: Array.isArray(sale?.audit) ? sale.audit.slice(-3).map(row => ({ id: text(row?.id), type: text(row?.type), at: row?.at ?? null })) : [],
  cacheSummary: true,
})

const sortNewest = (left, right) => number(right?.createdAt) - number(left?.createdAt)

export const compactSalesCache = (sales, { maxRows = SALES_CACHE_MAX_ROWS } = {}) => {
  const rows = Array.isArray(sales) ? sales.filter(row => row && saleId(row)) : []
  // A small pending sale may retain its payload locally for recovery; the
  // completed/history cache is always summarized and capped.
  // Pending rows are never capped here: the queue owns the retry identity, but
  // the ledger must still retain every pending payload until readback resolves it.
  const pending = rows.filter(isPending)
  const verified = rows.filter(row => !isPending(row)).sort(sortNewest).slice(0, maxRows).map(summarizeSaleForCache)
  return [...pending, ...verified]
}

export const readSalesCache = (storage = globalThis.localStorage) => {
  try {
    const raw = storage?.getItem?.(SALES_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

const serializedBytes = value => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  try { return new Blob([raw]).size } catch { return raw.length * 2 }
}

export const inspectLocalStorage = (storage = globalThis.localStorage) => {
  const keys = []
  let totalBytes = 0
  let salesBytes = 0
  if (storage) {
    for (let index = 0; index < Number(storage.length || 0); index += 1) {
      const key = storage.key(index)
      if (key === null) continue
      let raw = ''
      try { raw = storage.getItem(key) || '' } catch { raw = '' }
      const bytes = serializedBytes(raw)
      keys.push({ key, bytes })
      totalBytes += bytes
      if (key === SALES_CACHE_KEY) salesBytes = bytes
    }
  }
  const oversizedKeys = keys.filter(row => row.bytes >= 64 * 1024).sort((left, right) => right.bytes - left.bytes)
  return {
    totalBytes,
    salesBytes,
    salesCount: readSalesCache(storage).length,
    oversizedKeys,
    fullSalesCachePresent: readSalesCache(storage).some(row => row && !isPending(row) && row.cacheSummary !== true && (Array.isArray(row.items) || row.order?.items)),
    quotaRisk: salesBytes >= SALES_CACHE_MAX_BYTES || totalBytes >= 4 * 1024 * 1024 || oversizedKeys.length > 0,
  }
}

export const testLocalStorageWrite = (storage = globalThis.localStorage) => {
  try {
    storage?.setItem?.(STORAGE_PROBE_KEY, '1')
    storage?.removeItem?.(STORAGE_PROBE_KEY)
    return { ok: true, error: '' }
  } catch (error) {
    try { storage?.removeItem?.(STORAGE_PROBE_KEY) } catch { /* best effort */ }
    return { ok: false, error: error?.name || error?.message || 'STORAGE_WRITE_FAILED' }
  }
}

export const cleanupOversizedLocalCaches = ({ storage = globalThis.localStorage, centralReadable = false } = {}) => {
  const cleanedKeys = []
  const preservedKeys = [...PROTECTED_KEYS]
  const before = inspectLocalStorage(storage)
  if (centralReadable && before.fullSalesCachePresent) {
    const compacted = compactSalesCache(readSalesCache(storage))
    try {
      storage?.setItem?.(SALES_CACHE_KEY, JSON.stringify(compacted))
      cleanedKeys.push(SALES_CACHE_KEY)
    } catch {
      // A quota failure is not permission to delete the ledger. Leave the
      // original value in place so pending sale payloads remain recoverable.
    }
  }
  for (const row of before.oversizedKeys) {
    if (row.key === SALES_CACHE_KEY || PROTECTED_KEYS.has(row.key)) continue
    if (/^(pos101\.(report|image|blob|diagnostic)|reportCache|imageCache)/i.test(row.key)) {
      try { storage?.removeItem?.(row.key); cleanedKeys.push(row.key) } catch { /* best effort */ }
    }
  }
  return { cleanedKeys: [...new Set(cleanedKeys)], preservedKeys, before, after: inspectLocalStorage(storage) }
}

export const writeSalesCache = (sales, { storage = globalThis.localStorage, centralReadable = false } = {}) => {
  const compacted = compactSalesCache(sales)
  const write = rows => {
    try {
      storage?.setItem?.(SALES_CACHE_KEY, JSON.stringify(rows))
      return true
    } catch { return false }
  }
  if (write(compacted)) return { ok: true, quota: false, cleanedKeys: [], count: compacted.length, bytes: serializedBytes(compacted) }
  const cleanup = cleanupOversizedLocalCaches({ storage, centralReadable })
  const retryRows = compactSalesCache(sales, { maxRows: 20 })
  if (write(retryRows)) return { ok: true, quota: true, cleanedKeys: cleanup.cleanedKeys, count: retryRows.length, bytes: serializedBytes(retryRows) }
  return { ok: false, quota: true, cleanedKeys: cleanup.cleanedKeys, count: 0, bytes: 0, preservedKeys: cleanup.preservedKeys }
}

export const persistLocalSaleAfterCentralReadback = (sale, markLocalSync) => {
  try {
    const result = typeof markLocalSync === 'function' ? markLocalSync(sale) : null
    const cacheFailed = Boolean(result?.cacheWrite && result.cacheWrite.ok === false)
    return { centralSaleSafe: true, localCacheOk: !cacheFailed, warning: cacheFailed ? 'تم حفظ البيع مركزيًا. تم تنظيف الكاش المحلي.' : '' }
  } catch {
    return { centralSaleSafe: true, localCacheOk: false, warning: 'تم حفظ البيع مركزيًا. تم تنظيف الكاش المحلي.' }
  }
}

export const isProtectedLocalStorageKey = key => PROTECTED_KEYS.has(String(key || ''))
