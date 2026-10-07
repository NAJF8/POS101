const SALES_KEY = 'pos101.sales'
const QUEUE_KEY = 'pos101.syncQueue'
export const QUARANTINE_BUCKET = 'pos101.salesQuarantine'

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

const text = value => String(value ?? '').trim()
const requiredIdentity = sale => ({
  saleId: text(saleIdOf(sale)),
  operationKey: text(operationKeyOf(sale)),
  businessDate: text(sale?.businessDate),
  operationalDayId: text(sale?.operationalDayId || sale?.operational_day_id),
})
export const missingSaleIdentity = sale => Object.entries(requiredIdentity(sale)).filter(([, value]) => !value).map(([key]) => key)
export const isSaleIdentityComplete = sale => missingSaleIdentity(sale).length === 0
export const isInvalidSaleStatus = sale => cancelledStatuses.has(text(sale?.status).toLowerCase())

const stable = value => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out }, {})
  return value
}
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const normalizedItems = sale => saleItems(sale).map(item => ({
  id: text(item?.id || item?.productId || item?.product_id || item?.sku || item?.name),
  quantity: number(item?.quantity),
  unitPrice: number(item?.unitPrice ?? item?.price ?? item?.unit_price),
  lineTotal: number(item?.lineTotal ?? item?.total ?? (number(item?.quantity) * number(item?.unitPrice ?? item?.price ?? item?.unit_price))),
})).sort((a, b) => `${a.id}|${a.unitPrice}|${a.quantity}`.localeCompare(`${b.id}|${b.unitPrice}|${b.quantity}`))
export const financialFingerprint = sale => JSON.stringify(stable({
  items: normalizedItems(sale),
  gross: number(sale?.gross ?? sale?.subtotal),
  discount: number(sale?.discount),
  net: number(sale?.net ?? sale?.total ?? sale?.subtotal),
  cashAmount: number(sale?.cashAmount ?? sale?.payment?.cashAmount),
  electronicAmount: number(sale?.electronicAmount ?? sale?.payment?.electronicAmount),
  paymentMethod: text(sale?.paymentMethod || sale?.payment?.method),
  operationalDayId: text(sale?.operationalDayId || sale?.operational_day_id),
  businessDate: text(sale?.businessDate),
}))
export const salePayloadMatches = (expected, actual) => Boolean(expected && actual
  && text(saleIdOf(expected)) === text(saleIdOf(actual))
  && (!operationKeyOf(expected) || text(operationKeyOf(expected)) === text(operationKeyOf(actual)))
  && text(expected?.businessDate) === text(actual?.businessDate)
  && text(expected?.operationalDayId || expected?.operational_day_id) === text(actual?.operationalDayId || actual?.operational_day_id)
  && number(expected?.net ?? expected?.total ?? expected?.subtotal) === number(actual?.net ?? actual?.total ?? actual?.subtotal)
  && text(expected?.paymentMethod || expected?.payment?.method) === text(actual?.paymentMethod || actual?.payment?.method)
  && financialFingerprint(expected) === financialFingerprint(actual))

export const classifyCentralSale = (sale, centralSales = []) => {
  const id = text(saleIdOf(sale))
  const operationKey = text(operationKeyOf(sale))
  const byId = (centralSales || []).find(row => text(saleIdOf(row)) === id)
  const byOperation = operationKey && (centralSales || []).find(row => text(operationKeyOf(row)) === operationKey)
  if (byId && salePayloadMatches(sale, byId)) return { action: 'duplicate', central: byId, reason: 'CENTRAL_DUPLICATE' }
  if (byId) return { action: 'quarantine', central: byId, reason: 'SALE_ID_COLLISION' }
  if (byOperation && !salePayloadMatches(sale, byOperation)) return { action: 'quarantine', central: byOperation, reason: 'OPERATION_KEY_COLLISION' }
  return { action: 'upload', central: null, reason: '' }
}

const quarantineEntry = (sale, quarantineReason, raw = sale, now = Date.now()) => ({
  saleId: saleIdOf(sale) || '', orderNumber: sale?.orderNumber ?? '', operationKey: operationKeyOf(sale) || '',
  businessDate: sale?.businessDate || '', operationalDayId: sale?.operationalDayId || '', status: sale?.status || '',
  syncStatus: sale?.syncStatus || 'pending_sync', createdAt: sale?.createdAt || 0, updatedAt: sale?.updatedAt || now,
  net: sale?.net ?? sale?.total ?? sale?.subtotal ?? 0, paymentMethod: sale?.paymentMethod || sale?.payment?.method || '',
  rawQueuePayload: raw, quarantineReason, quarantinedAt: now,
})
export const readSalesQuarantine = () => readJson(QUARANTINE_BUCKET, [])
export const quarantineSale = (sale, quarantineReason, raw = sale) => {
  const existing = readSalesQuarantine()
  const entry = quarantineEntry(sale, quarantineReason, raw)
  const key = `${entry.saleId}|${entry.operationKey}|${entry.quarantineReason}`
  if (!existing.some(row => `${row.saleId}|${row.operationKey}|${row.quarantineReason}` === key)) writeJson(QUARANTINE_BUCKET, [...existing, entry])
  if (typeof console !== 'undefined') console.info('[POS_QUEUE_QUARANTINE]', { reason: quarantineReason, saleId: entry.saleId, orderNumber: entry.orderNumber, operationKeyPresent: Boolean(entry.operationKey), dayIdentityPresent: Boolean(entry.businessDate && entry.operationalDayId), classification: quarantineReason })
  return entry
}

const isSaleEntry = entry => Boolean(entry?.sale && isSaleSyncEligible(entry.sale) && isSaleIdentityComplete(entry.sale))
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
    lastErrorCode: error ? String(error?.code || '') : (existing?.lastErrorCode || ''),
  }
}

export const readRawSaleQueue = () => readJson(QUEUE_KEY, [])
export const readSaleQueue = () => readRawSaleQueue().filter(isSaleEntry)

export const readSalesCount = () => readJson(SALES_KEY, []).filter(sale => saleIdOf(sale)).length

export const readPendingSaleCount = () => {
  const seenIds = new Set()
  const seenOperationKeys = new Set()
  return readJson(SALES_KEY, []).reduce((count, sale) => {
    const saleId = saleIdOf(sale)
    const operationKey = operationKeyOf(sale)
    if (!isSaleSyncEligible(sale) || seenIds.has(saleId) || (operationKey && seenOperationKeys.has(operationKey)) || sale.status === 'synced' || sale.syncStatus === 'synced' || sale.centralVerified === true || sale.syncConfirmedAt) return count
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
  const sales = readJson(SALES_KEY, [])
  const queue = readJson(QUEUE_KEY, [])
  const reconciledIds = new Set()
  for (const sale of sales) {
    if (!isSaleSyncEligible(sale) || sale.syncStatus === 'synced' || sale.centralVerified === true || sale.syncConfirmedAt) continue
    // Identity alone is not sufficient: a collision must remain blocked. A
    // local sale is verified only after the complete financial payload matches.
    if ((centralSales || []).some(remote => salePayloadMatches(sale, remote))) reconciledIds.add(saleIdOf(sale))
  }
  if (!reconciledIds.size) return { reconciled: 0, remaining: readPendingSaleCount() }
  writeJson(SALES_KEY, sales.map(sale => reconciledIds.has(saleIdOf(sale))
    ? { ...sale, syncStatus: 'synced', centralVerified: true, centralVerifiedAt: Date.now(), syncConfirmedAt: Date.now(), syncSource: 'firebase-readback' }
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
  if (!saleId) { quarantineSale(sale, 'LEGACY_UNSAFE_QUEUE', { sale }); return sale }
  const sales = readJson(SALES_KEY, [])
  if (!isSaleIdentityComplete(sale)) {
    if (!sales.some(row => sameSaleIdentity(row, sale))) writeJson(SALES_KEY, [...sales, sale])
    quarantineSale(sale, 'LEGACY_UNSAFE_QUEUE', { sale })
    return sale
  }
  if (!isSaleSyncEligible(sale)) {
    if (!sales.some(row => sameSaleIdentity(row, sale))) writeJson(SALES_KEY, [...sales, sale])
    if (isInvalidSaleStatus(sale)) quarantineSale(sale, 'INVALID_STATUS', { sale })
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
  const queue = readRawSaleQueue()
  let added = 0
  let quarantined = 0
  for (const entry of queue) {
    const sale = entry?.sale || entry
    if (!isSaleIdentityComplete(sale)) { quarantineSale(sale, 'LEGACY_UNSAFE_QUEUE', entry); quarantined += 1 }
    else if (!isSaleSyncEligible(sale) || isInvalidSaleStatus(sale)) { quarantineSale(sale, 'INVALID_STATUS', entry); quarantined += 1 }
    else if (!sales.some(row => sameSaleIdentity(row, sale))) { quarantineSale(sale, 'QUEUE_WITHOUT_LEDGER', entry); quarantined += 1 }
  }
  for (const sale of sales) {
    if (!isSaleSyncEligible(sale) || sale.status === 'synced' || sale.syncConfirmedAt) continue
    if (queue.some(entry => isSaleEntry(entry) && sameSaleIdentity(entry.sale, sale))) continue
    queue.push(queueEntryForSale(sale))
    added += 1
  }
  if (added) writeJson(QUEUE_KEY, queue)
  return { added, quarantined, queue: queue.filter(isSaleEntry), pendingCount: readPendingSaleCount() }
}

export const buildSalesBackup = (createdAt = new Date().toISOString()) => {
  const sales = readJson(SALES_KEY, [])
  return { createdAt, salesCount: sales.length, 'pos101.sales': sales }
}

export const markSaleSynced = (sale, syncConfirmedAt = Date.now()) => {
  const saleId = saleIdOf(sale)
  const sales = readJson(SALES_KEY, [])
  writeJson(SALES_KEY, sales.map(row => sameSale(row, saleId)
    ? { ...row, status: 'synced', syncStatus: 'synced', centralVerified: true, centralVerifiedAt: syncConfirmedAt, syncConfirmedAt }
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

export const markSaleAttempt = (entry, attemptedAt = Date.now()) => {
  if (!entry?.sale) return null
  const saleId = saleIdOf(entry.sale)
  const queue = readJson(QUEUE_KEY, [])
  let updated = null
  const nextQueue = queue.map(row => {
    if (!isSaleEntry(row) || !sameSaleIdentity(row.sale, entry.sale)) return row
    updated = queueEntryForSale(row.sale, {
      existing: row,
      queuedAt: row.queuedAt,
    })
    updated.attempts = Number(row.attempts || 0) + 1
    updated.lastAttemptAt = attemptedAt
    updated.lastError = ''
    updated.lastErrorCode = ''
    return updated
  })
  if (updated) writeJson(QUEUE_KEY, nextQueue)
  return updated || { ...entry, attempts: Number(entry.attempts || 0) + 1, lastAttemptAt: attemptedAt, lastError: '', lastErrorCode: '' }
}
