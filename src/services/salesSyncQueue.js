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
const isSaleEntry = entry => Boolean(entry?.sale && saleIdOf(entry.sale))

export const readSaleQueue = () => readJson(QUEUE_KEY, []).filter(entry => entry?.sale && saleIdOf(entry.sale))

export const readSalesCount = () => readJson(SALES_KEY, []).filter(sale => saleIdOf(sale)).length

export const readPendingSaleCount = () => {
  const seenIds = new Set()
  const seenOperationKeys = new Set()
  return readJson(SALES_KEY, []).reduce((count, sale) => {
    const saleId = saleIdOf(sale)
    const operationKey = operationKeyOf(sale)
    if (!saleId || seenIds.has(saleId) || (operationKey && seenOperationKeys.has(operationKey)) || sale.status === 'synced' || sale.syncConfirmedAt) return count
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
  status: 'pending_sync',
  ...(error ? { syncError: String(error?.message || error) } : {}),
})

// The local ledger is authoritative for the POS. Queueing must never rewrite
// it: a cashier may already have real historic sales in this browser.
export const enqueueSale = (sale, { error, queuedAt = Date.now() } = {}) => {
  const saleId = saleIdOf(sale)
  if (!saleId) throw new Error('Cannot queue a sale without saleId.')
  const sales = readJson(SALES_KEY, [])
  if (!sales.some(row => sameSaleIdentity(row, sale))) writeJson(SALES_KEY, [...sales, sale])
  return sale
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
    if (!saleIdOf(sale) || sale.status === 'synced' || sale.syncConfirmedAt) continue
    if (queue.some(entry => isSaleEntry(entry) && sameSaleIdentity(entry.sale, sale))) continue
    queue.push({ kind: 'sale', sale: pendingSale(sale), queuedAt: Date.now() })
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
    ? { ...row, status: 'synced', syncConfirmedAt }
    : row))
  writeJson(QUEUE_KEY, readJson(QUEUE_KEY, []).filter(entry => !isSaleEntry(entry) || !sameSale(entry.sale, saleId)))
}

export const retainQueuedSale = (entry, error) => {
  const sale = pendingSale(entry.sale, error)
  const saleId = saleIdOf(sale)
  const queue = readJson(QUEUE_KEY, []).map(row => isSaleEntry(row) && sameSale(row.sale, saleId)
    ? { ...row, kind: 'sale', sale }
    : row)
  writeJson(QUEUE_KEY, queue)
  const sales = readJson(SALES_KEY, [])
  writeJson(SALES_KEY, sales.map(row => sameSale(row, saleId) ? sale : row))
}
