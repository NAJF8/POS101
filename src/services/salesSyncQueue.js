const SALES_KEY = 'pos101.sales'
const QUEUE_KEY = 'pos101.syncQueue'

const readJson = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key))
    return value ?? fallback
  } catch {
    return fallback
  }
}

const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value))
const saleIdOf = sale => sale?.saleId || sale?.id
const operationKeyOf = sale => sale?.operationKey || sale?.operation_key
const sameSale = (sale, saleId) => saleIdOf(sale) === saleId
const sameSaleIdentity = (left, right) => {
  const leftId = saleIdOf(left)
  const rightId = saleIdOf(right)
  const leftOperationKey = operationKeyOf(left)
  const rightOperationKey = operationKeyOf(right)
  return Boolean((leftId && rightId && leftId === rightId)
    || (leftOperationKey && rightOperationKey && leftOperationKey === rightOperationKey))
}
const cancelledStatuses = new Set(['cancelled', 'canceled', 'voided', 'abandoned', 'draft'])
const saleItems = sale => Array.isArray(sale?.items)
  ? sale.items
  : Array.isArray(sale?.order?.items) ? sale.order.items : []

export const isSaleSyncEligible = sale => {
  const id = String(saleIdOf(sale) || '').trim()
  const status = String(sale?.status || '').trim().toLowerCase()
  const total = Number(sale?.total ?? sale?.subtotal)
  return Boolean(id
    && !cancelledStatuses.has(status)
    && saleItems(sale).length > 0
    && Number.isFinite(total)
    && total >= 0)
}

const isSaleEntry = entry => Boolean(entry?.sale && isSaleSyncEligible(entry.sale))
const queueEntryForSale = (sale, { existing = null, error = '', queuedAt = Date.now() } = {}) => {
  const pending = pendingSale(sale, error)
  const attempts = Number(existing?.attempts)
  return {
    kind: 'sale',
    queueKey: String(saleIdOf(sale)),
    sale: pending,
    saleId: saleIdOf(sale),
    operationKey: operationKeyOf(sale) || '',
    orderNumber: sale?.orderNumber ?? '',
    businessDate: sale?.businessDate || '',
    operationalDayId: sale?.operationalDayId || '',
    createdAt: sale?.createdAt || 0,
    total: Number(sale?.total ?? sale?.subtotal ?? 0),
    paymentType: sale?.paymentMethod || sale?.payment?.method || '',
    status: 'pending',
    queuedAt: existing?.queuedAt || queuedAt,
    attempts: Number.isFinite(attempts) && attempts >= 0 ? attempts : 0,
    lastAttemptAt: existing?.lastAttemptAt || null,
    lastError: error ? String(error?.message || error) : (existing?.lastError || ''),
  }
}

export const readSaleQueue = () => readJson(QUEUE_KEY, []).filter(isSaleEntry)

export const readSalesCount = () => readJson(SALES_KEY, []).filter(sale => saleIdOf(sale)).length

export const readPendingSaleCount = () => {
  const seenIds = new Set()
  const seenOperationKeys = new Set()
  return readJson(SALES_KEY, []).reduce((count, sale) => {
    const saleId = saleIdOf(sale)
    const operationKey = operationKeyOf(sale)
    if (!isSaleSyncEligible(sale) || seenIds.has(saleId) || (operationKey && seenOperationKeys.has(operationKey)) || sale.status === 'synced' || sale.syncConfirmedAt) return count
    seenIds.add(saleId)
    if (operationKey) seenOperationKeys.add(operationKey)
    return count + 1
  }, 0)
}

const centralIdentity = sale => ({
  saleId: saleIdOf(sale),
  operationKey: operationKeyOf(sale),
})

// Reconciliation is deliberately identity-only. It never uploads or changes
// sale content; it marks a local row synced only after the same central
// saleId/operationKey was independently read from Firebase.
export const reconcileSalesAgainstCentral = centralSales => {
  const central = new Map()
  for (const sale of centralSales || []) {
    const identity = centralIdentity(sale)
    if (identity.saleId) central.set(`id:${identity.saleId}`, sale)
    if (identity.operationKey) central.set(`op:${identity.operationKey}`, sale)
  }
  const sales = readJson(SALES_KEY, [])
  const queue = readJson(QUEUE_KEY, [])
  const reconciledIds = new Set()
  for (const sale of sales) {
    if (!isSaleSyncEligible(sale)) continue
    const identity = centralIdentity(sale)
    if ((identity.saleId && central.has(`id:${identity.saleId}`)) || (identity.operationKey && central.has(`op:${identity.operationKey}`))) {
      reconciledIds.add(identity.saleId)
    }
  }
  if (!reconciledIds.size) return { reconciled: 0, remaining: readPendingSaleCount() }
  writeJson(SALES_KEY, sales.map(sale => reconciledIds.has(saleIdOf(sale))
    ? { ...sale, status: 'synced', syncConfirmedAt: Date.now(), syncSource: 'firebase-readback' }
    : sale))
  writeJson(QUEUE_KEY, queue.filter(entry => !isSaleEntry(entry) || !reconciledIds.has(saleIdOf(entry.sale))))
  return { reconciled: reconciledIds.size, remaining: readPendingSaleCount() }
}

export const pendingSale = (sale, error) => ({
  ...sale,
  syncStatus: 'pending',
  ...(error ? { syncError: String(error?.message || error) } : {}),
})

// The local ledger is authoritative for the POS. A completed sale is committed
// to both the ledger and the durable queue before this function returns.
export const enqueueSale = (sale, { error, queuedAt = Date.now() } = {}) => {
  const saleId = saleIdOf(sale)
  if (!saleId) throw new Error('Cannot queue a sale without saleId.')
  const sales = readJson(SALES_KEY, [])
  if (!isSaleSyncEligible(sale)) {
    if (!sales.some(row => sameSaleIdentity(row, sale))) writeJson(SALES_KEY, [...sales, sale])
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sale-created', { detail: sale }))
    return sale
  }
  const localSale = pendingSale(sale, error)
  const nextSales = sales.some(row => sameSaleIdentity(row, sale))
    ? sales.map(row => sameSaleIdentity(row, sale) ? { ...row, ...localSale } : row)
    : [...sales, localSale]
  const queue = readJson(QUEUE_KEY, [])
  const existing = queue.find(entry => entry?.sale && sameSaleIdentity(entry.sale, sale))
  const nextQueue = existing
    ? queue.map(entry => entry === existing ? queueEntryForSale(localSale, { existing, error, queuedAt }) : entry)
    : [...queue, queueEntryForSale(localSale, { error, queuedAt })]
  writeJson(SALES_KEY, nextSales)
  writeJson(QUEUE_KEY, nextQueue)
  const persistedSales = readJson(SALES_KEY, [])
  const persistedQueue = readSaleQueue()
  const ledgerSaved = persistedSales.some(row => sameSaleIdentity(row, sale))
  const queueSaved = persistedQueue.some(entry => sameSaleIdentity(entry.sale, sale))
  if (!ledgerSaved || !queueSaved) {
    const persisted = pendingSale(sale, 'local queue persistence failed')
    writeJson(SALES_KEY, persistedSales.map(row => sameSaleIdentity(row, sale) ? { ...row, ...persisted } : row))
    throw Object.assign(new Error('تعذر حفظ المبيعة في طابور المزامنة المحلي.'), { code: 'SALE_QUEUE_PERSISTENCE_FAILED' })
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sale-created', { detail: sale }))
  return persistedSales.find(row => sameSaleIdentity(row, sale)) || localSale
}

// Older builds wrote the authoritative sale ledger without adding a queue row.
// Reconcile those rows without deleting or replacing any sale or queue entry.
// The original saleId and operationKey are copied verbatim into the deferred
// queue, so a future integration can use them for idempotency.
export const reconcileSalesQueue = () => {
  const sales = readJson(SALES_KEY, [])
  const queue = readJson(QUEUE_KEY, [])
  let added = 0
  for (const sale of sales) {
    if (!isSaleSyncEligible(sale) || sale.status === 'synced' || sale.syncConfirmedAt) continue
    if (queue.some(entry => isSaleEntry(entry) && sameSaleIdentity(entry.sale, sale))) continue
    queue.push(queueEntryForSale(sale))
    added += 1
  }
  if (added) writeJson(QUEUE_KEY, queue)
  return { added, queue: queue.filter(isSaleEntry), pendingCount: readPendingSaleCount() }
}

export const buildSalesBackup = (createdAt = new Date().toISOString()) => {
  const sales = readJson(SALES_KEY, [])
  return { createdAt, salesCount: sales.length, 'pos101.sales': sales }
}

export const markSaleSynced = (sale, syncConfirmedAt = Date.now()) => {
  const saleId = saleIdOf(sale)
  const sales = readJson(SALES_KEY, [])
  writeJson(SALES_KEY, sales.map(row => sameSale(row, saleId)
    ? { ...row, status: 'synced', syncStatus: 'synced', syncConfirmedAt }
    : row))
  writeJson(QUEUE_KEY, readJson(QUEUE_KEY, []).filter(entry => !entry?.sale || !sameSaleIdentity(entry.sale, sale)))
}

export const retainQueuedSale = (entry, error) => {
  const sale = pendingSale(entry.sale, error)
  const saleId = saleIdOf(sale)
  const queue = readJson(QUEUE_KEY, []).map(row => isSaleEntry(row) && sameSale(row.sale, saleId)
    ? queueEntryForSale(sale, { existing: row, error, queuedAt: row.queuedAt })
    : row)
  writeJson(QUEUE_KEY, queue)
  const sales = readJson(SALES_KEY, [])
  writeJson(SALES_KEY, sales.map(row => sameSale(row, saleId) ? sale : row))
}
