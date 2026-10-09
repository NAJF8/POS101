const SALES_KEY = 'pos101.sales'
const QUEUE_KEY = 'pos101.syncQueue'
export const QUARANTINE_BUCKET = 'pos101.salesQuarantine'
export const SYNC_QUEUE_QUARANTINE_BUCKET = 'pos101.syncQueue.quarantine'
export const KNOWN_MANUAL_REVIEW_SALE_1056 = 'b55ca7d2-fd37-4aa9-bafe-866aa2f93810'
export const KNOWN_MANUAL_REVIEW_REASON_1056 = 'PREVIOUSLY_QUARANTINED_SALE_NOW_EXISTS_IN_FIREBASE_CONFLICTS_WITH_ORDER_1056'

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
const cancelledStatuses = new Set(['cancelled', 'canceled', 'voided', 'abandoned', 'draft', 'باطل', 'ملغي'])
const voidedStatuses = new Set(['cancelled', 'canceled', 'voided', 'باطل', 'ملغي'])
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
export const isVoidedSale = sale => voidedStatuses.has(text(sale?.status).toLowerCase()) || sale?.voided === true

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
  && text(expected?.orderNumber) === text(actual?.orderNumber || actual?.order_number)
  && text(expected?.businessDate) === text(actual?.businessDate)
  && text(expected?.operationalDayId || expected?.operational_day_id) === text(actual?.operationalDayId || actual?.operational_day_id)
  && number(expected?.net ?? expected?.total ?? expected?.subtotal) === number(actual?.net ?? actual?.total ?? actual?.subtotal)
  && saleItems(expected).length === saleItems(actual).length
  && text(expected?.paymentMethod || expected?.payment?.method) === text(actual?.paymentMethod || actual?.payment?.method)
  && financialFingerprint(expected) === financialFingerprint(actual))

const localStorageSnapshot = () => {
  const snapshot = {}
  if (typeof localStorage === 'undefined') return snapshot
  for (let index = 0; index < (Number(localStorage.length) || 0); index += 1) {
    const key = localStorage.key(index)
    if (key !== null) snapshot[key] = localStorage.getItem(key)
  }
  return snapshot
}

const exportLocalStorageBackup = (snapshot, now = new Date()) => {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const filename = `POS101-localStorage-before-queue-cleanup-${stamp}.json`
  const payload = JSON.stringify({ exportedAt: now.toISOString(), localStorage: snapshot }, null, 2)
  // Keep an in-memory copy for diagnostics/tests, while the browser download
  // is the durable operator backup. This never writes to Firebase.
  if (typeof window !== 'undefined') window.__POS101_LAST_QUEUE_CLEANUP_BACKUP__ = { filename, payload }
  if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  }
  return { filename, payload }
}

const queueIdentity = row => row?.sale || row || {}
const comparable = value => String(value ?? '').trim()
const centralMatchForQueueEntry = (rawEntry, centralSales) => {
  const local = queueIdentity(rawEntry)
  const localSaleId = comparable(local?.saleId || local?.id || rawEntry?.saleId)
  const localOrderNumber = comparable(local?.orderNumber || rawEntry?.orderNumber)
  if (!localSaleId && !localOrderNumber) return null
  return (centralSales || []).find(remote => {
    const sameIdentity = (localSaleId && comparable(remote?.saleId || remote?.id) === localSaleId)
      || (localOrderNumber && comparable(remote?.orderNumber) === localOrderNumber)
    if (!sameIdentity) return false
    // Identity and headline totals are only candidate filters. A queue item
    // may be removed or marked synced only after the complete financial
    // payload has been read back from Firebase.
    return salePayloadMatches(local, remote)
  }) || null
}

// Read-only central reconciliation for legacy queue rows. The caller must
// supply a snapshot already read from Firebase; this function never performs
// a Firebase operation and never creates or updates a sale.
export const reconcileLocalQueueAgainstCentral = (centralSales = [], { now = new Date() } = {}) => {
  const queue = readRawSaleQueue()
  const quarantine = readJson(SYNC_QUEUE_QUARANTINE_BUCKET, [])
  const removals = []
  const quarantined = []
  const retained = []
  for (const [index, rawEntry] of queue.entries()) {
    // Non-sale rows belong to their own domain queue. Preserve them here;
    // expense readback resolution is performed by runExpenseCentralSync.
    if (!rawEntry?.sale && (rawEntry?.expense || rawEntry?.kind === 'expense')) { retained.push(rawEntry); continue }
    const central = centralMatchForQueueEntry(rawEntry, centralSales)
    const sale = queueIdentity(rawEntry)
    const valid = Boolean(rawEntry?.sale && isSaleSyncEligible(rawEntry?.sale) && isSaleIdentityComplete(rawEntry?.sale))
    if (central) {
      removals.push({ index, rawEntry, sale, central, action: valid ? 'mark-synced-and-remove' : 'remove-verified-malformed', reason: valid ? 'CENTRAL_PAYLOAD_VERIFIED' : 'CENTRAL_IDENTITY_VERIFIED_MALFORMED' })
    } else if (!valid) {
      quarantined.push({ index, rawEntry, sale, action: 'quarantine-and-remove', reason: 'MALFORMED_UNMATCHED_QUEUE_ENTRY' })
    } else retained.push(rawEntry)
  }
  const changed = removals.length + quarantined.length > 0
  const backup = changed ? exportLocalStorageBackup(localStorageSnapshot(), now) : null
  const removalIndexes = new Set([...removals, ...quarantined].map(row => row.index))
  if (changed) {
    const syncedIds = new Set(removals.filter(row => row.action === 'mark-synced-and-remove').map(row => saleIdOf(row.sale)))
    const sales = readJson(SALES_KEY, [])
    writeJson(SALES_KEY, sales.map(sale => syncedIds.has(saleIdOf(sale))
      ? { ...sale, status: 'synced', syncStatus: 'synced', centralVerified: true, centralVerifiedAt: now.getTime(), syncConfirmedAt: now.getTime(), syncSource: 'firebase-readback-queue-cleanup' }
      : sale))
    writeJson(QUEUE_KEY, queue.filter((_, index) => !removalIndexes.has(index)))
    const nextQuarantine = [...quarantine, ...quarantined.map(row => ({
      quarantineReason: row.reason,
      action: row.action,
      quarantinedAt: now.getTime(),
      saleId: saleIdOf(row.sale) || '',
      orderNumber: row.sale?.orderNumber ?? row.rawEntry?.orderNumber ?? '',
      operationKey: operationKeyOf(row.sale) || row.rawEntry?.operationKey || '',
      rawQueuePayload: row.rawEntry,
      centralMatch: row.central || null,
      backupFilename: backup.filename,
    }))]
    writeJson(SYNC_QUEUE_QUARANTINE_BUCKET, nextQuarantine)
    for (const row of [...removals, ...quarantined]) {
      console.info('[POS101_QUEUE_CLEANUP]', JSON.stringify({ action: row.action, reason: row.reason, saleId: saleIdOf(row.sale), orderNumber: row.sale?.orderNumber ?? row.rawEntry?.orderNumber ?? '', backupFilename: backup.filename }))
    }
  }
  return {
    backupBeforeCleanup: changed ? 'PASS' : 'NOT_REQUIRED',
    backupFilename: backup?.filename || null,
    centralReadOnly: true,
    firebaseWritesPerformed: 0,
    removedVerified: removals.length,
    quarantinedMalformed: quarantined.length,
    retainedValidUnresolved: retained.length,
    queueLengthBefore: queue.length,
    queueLengthAfter: changed ? readRawSaleQueue().length : queue.length,
    quarantineLength: readJson(SYNC_QUEUE_QUARANTINE_BUCKET, []).length,
    actions: [...removals, ...quarantined].map(row => ({ index: row.index, action: row.action, reason: row.reason, saleId: saleIdOf(row.sale), orderNumber: row.sale?.orderNumber ?? row.rawEntry?.orderNumber ?? '' })),
  }
}

export const classifyCentralSale = (sale, centralSales = []) => {
  const id = text(saleIdOf(sale))
  const operationKey = text(operationKeyOf(sale))
  const byId = (centralSales || []).find(row => text(saleIdOf(row)) === id)
  const byOperation = operationKey && (centralSales || []).find(row => text(operationKeyOf(row)) === operationKey)
  if (byId && isVoidedSale(byId)) return { action: 'quarantine', central: byId, reason: 'SALE_ID_VOIDED_COLLISION' }
  if (byOperation && isVoidedSale(byOperation)) return { action: 'quarantine', central: byOperation, reason: 'OPERATION_KEY_VOIDED_COLLISION' }
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

export const isManualReviewQuarantined = saleId => readSalesQuarantine().some(row => (
  row.saleId === saleId && row.manualReviewRequired === true
))

// Idempotent local review metadata only. It preserves the local ledger and
// Firebase record and excludes the protected sale from automatic recovery.
export const restoreManualReviewQuarantineMarker = ({ saleId, orderNumber, reason, centralExists = false } = {}) => {
  const id = text(saleId)
  if (!id) return { restored: false, reason: 'SALE_ID_REQUIRED' }
  const existing = readSalesQuarantine()
  const marker = {
    saleId: id,
    orderNumber: orderNumber ?? '',
    quarantineReason: reason || 'MANUAL_REVIEW_REQUIRED',
    manualReviewRequired: true,
    autoRecoveryExcluded: true,
    centralExists: Boolean(centralExists),
    restoredAt: Date.now(),
  }
  const sameMarker = row => row.saleId === marker.saleId && row.manualReviewRequired === true
  if (!existing.some(sameMarker)) writeJson(QUARANTINE_BUCKET, [...existing, marker])
  return { restored: true, marker: existing.find(sameMarker) || marker }
}

const queueEntryExpense = entry => entry?.expense || (entry?.kind === 'expense' ? entry : null)
const expenseIdOf = expense => text(expense?.id || expense?.expenseId)

// Legacy builds accidentally placed expense rows in the sale queue. Remove
// only rows whose same id is present in a caller-supplied Firebase readback;
// unresolved rows remain intact for the expense path.
export const resolveLegacyExpenseQueueEntries = (centralExpenses = []) => {
  const queue = readRawSaleQueue()
  const auditKey = 'pos101.syncQueue.expenseResolutionAudit'
  const audit = readJson(auditKey, [])
  let identified = 0
  let resolved = 0
  const retained = []
  for (const entry of queue) {
    const expense = queueEntryExpense(entry)
    if (!expense) { retained.push(entry); continue }
    identified += 1
    const id = expenseIdOf(expense)
    const remote = id && (centralExpenses || []).find(row => expenseIdOf(row) === id)
    if (!remote) { retained.push(entry); continue }
    resolved += 1
    audit.push({ id, action: 'verified-central-readback-remove-from-sale-queue', resolvedAt: Date.now(), firebaseWritesPerformed: 0 })
  }
  if (resolved) {
    writeJson(QUEUE_KEY, retained)
    writeJson(auditKey, audit.slice(-100))
  }
  return { identified, resolved, retained: retained.length, firebaseWritesPerformed: 0 }
}

// Legacy queue rows may predate operationKey/businessDate persistence. They
// remain real sale entries when their sale payload is otherwise valid; the
// sync layer normalizes the missing identity fields before writing.
const isSaleWriteEntry = entry => Boolean(entry?.sale && isSaleSyncEligible(entry.sale)
  && (entry?.type === 'sale_write' || entry?.kind === 'sale' || !entry?.type))
const isVoidUpdateEntry = entry => Boolean(entry && (entry?.type === 'void_update' || entry?.kind === 'void_update') && entry?.saleId)
const isSaleEntry = isSaleWriteEntry
const queueEntryForSale = (sale, { existing = null, error = '', queuedAt = Date.now() } = {}) => {
  const pending = pendingSale(sale, error)
  const attempts = Number(existing?.attemptCount ?? existing?.attempts)
  return {
    type: 'sale_write',
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
    attemptCount: Number.isFinite(attempts) && attempts >= 0 ? attempts : 0,
    lastAttemptAt: existing?.lastAttemptAt || null,
    lastError: error ? String(error?.message || error) : (existing?.lastError || ''),
    lastErrorCode: error ? String(error?.code || '') : (existing?.lastErrorCode || ''),
  }
}

export const readRawSaleQueue = () => readJson(QUEUE_KEY, [])
export const readSaleQueue = () => readRawSaleQueue().filter(isSaleEntry)
export const readVoidUpdateQueue = () => readRawSaleQueue().filter(isVoidUpdateEntry)

const voidQueueEntry = (sale, voidPayload = {}, { existing = null, error = '', queuedAt = Date.now() } = {}) => {
  const saleId = saleIdOf(sale)
  const attempts = Number(existing?.attemptCount ?? existing?.attempts)
  return {
    type: 'void_update',
    kind: 'void_update',
    queueKey: `void:${saleId}`,
    saleId,
    orderNumber: sale?.orderNumber ?? '',
    businessDate: sale?.businessDate || '',
    operationalDayId: sale?.operationalDayId || sale?.operational_day_id || '',
    voidPayload: { ...voidPayload, saleId },
    status: 'pending',
    queuedAt: existing?.queuedAt || queuedAt,
    attempts: Number.isFinite(attempts) && attempts >= 0 ? attempts : 0,
    attemptCount: Number.isFinite(attempts) && attempts >= 0 ? attempts : 0,
    lastAttemptAt: existing?.lastAttemptAt || null,
    lastError: error ? String(error?.message || error) : (existing?.lastError || ''),
    lastErrorCode: error ? String(error?.code || '') : (existing?.lastErrorCode || ''),
  }
}

export const enqueueVoidUpdate = (sale, voidPayload = {}, { error, queuedAt = Date.now() } = {}) => {
  const saleId = saleIdOf(sale)
  if (!saleId) throw Object.assign(new Error('معرف البيع مطلوب لطابور الإبطال.'), { code: 'VOID_SALE_ID_REQUIRED' })
  const queue = readRawSaleQueue()
  const existing = queue.find(entry => isVoidUpdateEntry(entry) && String(entry.saleId) === String(saleId))
  const nextEntry = voidQueueEntry(sale, voidPayload, { existing, error, queuedAt })
  const nextQueue = existing ? queue.map(entry => entry === existing ? nextEntry : entry) : [...queue, nextEntry]
  writeJson(QUEUE_KEY, nextQueue)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sale-updated', { detail: { saleId, type: 'void_update_queued' } }))
  return nextEntry
}

export const removeVoidUpdate = saleOrId => {
  const saleId = typeof saleOrId === 'object' ? saleIdOf(saleOrId) : String(saleOrId || '')
  const queue = readRawSaleQueue()
  writeJson(QUEUE_KEY, queue.filter(entry => !(isVoidUpdateEntry(entry) && String(entry.saleId) === saleId)))
}

export const resolveVoidedSaleLocally = (sale, { centralVerified = false, queueResolution = 'voided_before_central_sync', reason = 'local sale voided before Firebase write', resolvedAt = Date.now() } = {}) => {
  const id = saleIdOf(sale)
  const operationKey = operationKeyOf(sale)
  const matches = row => sameSaleIdentity(row, sale)
  const marker = { type: 'queue-resolution', at: resolvedAt, queueResolution, centralUploadSkipped: !centralVerified, reason }
  const sales = readJson(SALES_KEY, [])
  writeJson(SALES_KEY, sales.map(row => matches(row)
    ? { ...row, status: 'voided', voided: true, queueResolution, queueResolvedAt: resolvedAt, centralUploadSkipped: !centralVerified, centralVerified: centralVerified ? true : row.centralVerified === true, voidCentralVerified: centralVerified, queueResolutionReason: reason, audit: [...(Array.isArray(row.audit) ? row.audit : []), marker] }
    : row))
  writeJson(QUEUE_KEY, readRawSaleQueue().filter(entry => {
    if (isVoidUpdateEntry(entry)) return String(entry.saleId) !== String(id)
    const queued = entry?.sale || entry
    return !matches(queued)
  }))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sale-updated', { detail: { saleId: id, operationKey, queueResolution } }))
  return { saleId: id, operationKey, queueResolution, centralUploadSkipped: !centralVerified, queueResolvedAt: resolvedAt }
}

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

export const readSaleSyncStatus = () => {
  const diagnostic = readHeaderPendingDiagnostic()
  const queue = diagnostic.saleWriteEntries
  const voidQueue = diagnostic.voidUpdateEntries
  const pending = queue.filter(entry => String(entry?.status || 'pending').toLowerCase() === 'pending')
  const failed = queue.filter(entry => String(entry?.status || '').toLowerCase() === 'failed')
  const attempts = queue.map(entry => entry?.lastAttemptAt).filter(Boolean).sort((a, b) => Number(b) - Number(a))
  const errors = [...queue, ...voidQueue].map(entry => entry?.lastError).filter(Boolean)
  return {
    pendingCount: pending.length,
    failedCount: failed.length,
    pendingVoidCount: diagnostic.pendingVoidUpdateCount,
    failedVoidCount: voidQueue.filter(entry => String(entry?.status || '').toLowerCase() === 'failed').length,
    lastAttemptAt: attempts[0] || null,
    lastError: errors[0] || '',
    ...diagnostic,
  }
}

const saleIsVoidedBeforeCentral = sale => Boolean(sale && isVoidedSale(sale) && (
  sale.queueResolution === 'voided_before_central_sync'
  || sale.voidCentralVerified === true
  || sale.centralVerified === true
))

// Canonical header diagnostics. A voided row is still preserved in the local
// ledger/history, but it is not an active sale blocker after its void state has
// been verified (or the sale was explicitly voided before central creation).
export const readHeaderPendingDiagnostic = ({ orders = [], openOrderCount = null } = {}) => {
  const rawQueue = readRawSaleQueue()
  const storedSales = readJson(SALES_KEY, [])
  const localSales = Array.isArray(storedSales) ? storedSales : []
  const localById = new Map(localSales.map(sale => [String(saleIdOf(sale) || ''), sale]))
  const saleWriteEntries = rawQueue.filter(isSaleEntry)
  const voidUpdateEntries = rawQueue.filter(isVoidUpdateEntry)
  const activeSaleWriteEntries = saleWriteEntries.filter(entry => {
    const sale = entry?.sale || entry
    return !saleIsVoidedBeforeCentral(sale)
      && String(entry?.status || 'pending').toLowerCase() === 'pending'
  })
  const pendingVoidEntries = voidUpdateEntries.filter(entry => {
    const sale = localById.get(String(entry.saleId))
    return !saleIsVoidedBeforeCentral(sale)
      && String(entry?.status || 'pending').toLowerCase() === 'pending'
  })
  const activeLocalSales = localSales.filter(sale => isSaleSyncEligible(sale) && !isVoidedSale(sale))
  const unverifiedActiveSales = activeLocalSales.filter(sale => (
    sale.centralVerified !== true
    && sale.syncStatus !== 'synced'
    && sale.status !== 'synced'
    && !sale.syncConfirmedAt
  ))
  const staleVoidedQueueEntries = rawQueue.filter(entry => {
    const sale = entry?.sale || localById.get(String(entry.saleId))
    return saleIsVoidedBeforeCentral(sale)
  })
  const blockers = [
    ...activeSaleWriteEntries.map(entry => ({ entry, sale: entry?.sale || entry, reason: 'PENDING_SALE_WRITE' })),
    ...pendingVoidEntries.map(entry => ({ entry, sale: localById.get(String(entry.saleId)) || entry, reason: 'PENDING_VOID_UPDATE' })),
  ].filter(row => row.entry && String(row.entry.status || 'pending').toLowerCase() === 'pending')
  const last = blockers[blockers.length - 1]
  const currentCartDraftExists = Array.isArray(orders) && orders.some(order => Array.isArray(order?.items) && order.items.length > 0)
  const diagnostic = {
    pendingSaleWriteCount: activeSaleWriteEntries.length,
    pendingVoidUpdateCount: pendingVoidEntries.length,
    syncQueueCount: rawQueue.length,
    activePendingQueueCount: activeSaleWriteEntries.length + pendingVoidEntries.length,
    voidedBeforeSyncCount: staleVoidedQueueEntries.length,
    unsyncedLocalSalesCount: unverifiedActiveSales.length,
    unverifiedActiveSalesCount: unverifiedActiveSales.length,
    openOrderCount,
    currentCartDraftExists,
    lastBlockingOrderNumber: last?.sale?.orderNumber ?? last?.entry?.orderNumber ?? null,
    lastBlockingSaleId: saleIdOf(last?.sale) || last?.entry?.saleId || null,
    lastBlockingStatus: last?.sale?.status || last?.entry?.status || null,
    lastBlockingReason: last?.reason || '',
    saleWriteEntries,
    voidUpdateEntries,
  }
  return diagnostic
}

export const readPendingSaleDiagnostics = () => readRawSaleQueue()
  .filter(entry => isSaleEntry(entry) || isVoidUpdateEntry(entry))
  .map(entry => ({
    type: isVoidUpdateEntry(entry) ? 'void_update' : 'sale_write',
    saleId: saleIdOf(entry.sale) || entry.saleId,
    operationKey: operationKeyOf(entry.sale),
    orderNumber: entry.sale?.orderNumber ?? entry.orderNumber ?? null,
    total: Number(entry.sale?.total ?? entry.sale?.subtotal ?? entry.total ?? 0),
    businessDate: entry.sale?.businessDate || entry.businessDate || '',
    operationalDayId: entry.sale?.operationalDayId || entry.operationalDayId || '',
    lastAttemptAt: entry.lastAttemptAt || null,
    attempts: Number(entry.attemptCount ?? entry.attempts ?? 0),
    lastError: entry.lastError || entry.sale?.syncError || '',
    status: entry.status || 'pending',
  }))

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
export const enqueueSale = (sale, { error, queuedAt = Date.now(), dispatchEvent = true } = {}) => {
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
  const backup = buildSalesBackup(new Date(queuedAt).toISOString())
  writeJson('lastCompletedSaleBackup', backup)
  writeJson('dailySalesBackup', backup)
  localStorage.setItem('lastSaleBackupAt', String(queuedAt))
  if (dispatchEvent && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sale-created', { detail: sale }))
  return persistedSales.find(row => sameSaleIdentity(row, sale)) || localSale
}

// Older builds wrote the authoritative sale ledger without adding a queue row.
// Reconcile those rows without deleting or replacing any sale or queue entry.
// The original saleId and operationKey are copied verbatim into the deferred
// queue, so a future integration can use them for idempotency.
export const reconcileSalesQueue = (centralSales = [], { onStrandedSale = null } = {}) => {
  const sales = readJson(SALES_KEY, [])
  let nextSales = sales.slice()
  const queue = readRawSaleQueue()
  const centralIds = new Set((centralSales || []).map(saleIdOf).filter(Boolean))
  let added = 0
  let quarantined = 0
  const stranded = []
  for (const entry of queue) {
    if (!entry?.sale) continue
    const sale = entry?.sale || entry
    if (!isSaleIdentityComplete(sale)) { quarantineSale(sale, 'LEGACY_UNSAFE_QUEUE', entry); quarantined += 1 }
    else if (!isSaleSyncEligible(sale) || isInvalidSaleStatus(sale)) { quarantineSale(sale, 'INVALID_STATUS', entry); quarantined += 1 }
    else if (!sales.some(row => sameSaleIdentity(row, sale))) { quarantineSale(sale, 'QUEUE_WITHOUT_LEDGER', entry); quarantined += 1 }
  }
  for (const sale of sales) {
    if (!isSaleSyncEligible(sale) || sale.status === 'synced' || sale.syncConfirmedAt) continue
    if (isManualReviewQuarantined(saleIdOf(sale))) continue
    if (queue.some(entry => isSaleEntry(entry) && sameSaleIdentity(entry.sale, sale))) continue
    if (centralIds.has(saleIdOf(sale))) continue
    const recovered = { ...sale, recoveredFromLocalLedger: true, recoveryReason: 'STRANDED_LOCAL_SALE_NOT_IN_QUEUE' }
    stranded.push({ saleId: saleIdOf(sale), orderNumber: sale?.orderNumber ?? '', total: sale?.total ?? sale?.subtotal ?? 0, businessDate: sale?.businessDate || '', operationalDayId: sale?.operationalDayId || sale?.operational_day_id || '', reason: 'STRANDED_SALE_FOUND' })
    try { onStrandedSale?.(stranded[stranded.length - 1]) } catch {}
    queue.push(queueEntryForSale(recovered))
    nextSales = nextSales.map(row => sameSaleIdentity(row, sale) ? recovered : row)
    added += 1
  }
  if (JSON.stringify(nextSales) !== JSON.stringify(sales)) writeJson(SALES_KEY, nextSales)
  if (added) writeJson(QUEUE_KEY, queue)
  return { added, quarantined, stranded, queue: queue.filter(isSaleEntry), pendingCount: readPendingSaleCount() }
}

export const buildSalesBackup = (createdAt = new Date().toISOString()) => {
  const sales = readJson(SALES_KEY, [])
  return { createdAt, salesCount: sales.length, 'pos101.sales': sales }
}

export const markSaleSynced = (sale, syncConfirmedAt = Date.now()) => {
  const saleId = saleIdOf(sale)
  const sales = readJson(SALES_KEY, [])
  const operationKey = operationKeyOf(sale)
  const existingIndex = sales.findIndex(row => saleIdOf(row) === saleId)
  const operationIndex = existingIndex < 0 && operationKey
    ? sales.findIndex(row => operationKeyOf(row) === operationKey)
    : -1
  const index = existingIndex >= 0 ? existingIndex : operationIndex
  const synced = {
    ...sale,
    saleId,
    id: saleId,
    status: 'synced',
    syncStatus: 'synced',
    centralVerified: true,
    centralVerifiedAt: syncConfirmedAt,
    syncConfirmedAt,
  }
  const nextSales = index >= 0
    ? sales.map((row, rowIndex) => rowIndex === index ? { ...row, ...synced } : row)
    : sales.some(row => saleIdOf(row) === saleId) ? sales : [...sales, synced]
  writeJson(SALES_KEY, nextSales)
  writeJson(QUEUE_KEY, readJson(QUEUE_KEY, []).filter(entry => {
    if (entry?.expense || entry?.kind === 'expense' || entry?.type === 'expense') return true
    const queuedSale = entry?.sale || entry
    return !sameSaleIdentity(queuedSale, sale)
  }))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sale-created', { detail: synced }))
}

export const markSaleVoidedCentral = (sale, { voidConfirmedAt = Date.now(), queueResolution = 'void_status_synced', audit = null } = {}) => {
  const saleId = saleIdOf(sale)
  const sales = readJson(SALES_KEY, [])
  const existingIndex = sales.findIndex(row => saleIdOf(row) === saleId)
  const existing = existingIndex >= 0 ? sales[existingIndex] : null
  const auditRowsForSale = Array.isArray(existing?.audit) ? existing.audit : Array.isArray(sale?.audit) ? sale.audit : []
  const nextAudit = audit && !auditRowsForSale.some(item => item?.id && item.id === audit.id) ? [...auditRowsForSale, audit] : auditRowsForSale
  const voided = {
    ...sale,
    saleId,
    id: saleId,
    status: 'voided',
    voided: true,
    voidedAt: sale?.voidedAt || voidConfirmedAt,
    voidCentralVerified: true,
    voidConfirmedAt,
    queueResolution,
    audit: nextAudit,
  }
  const nextSales = existingIndex >= 0
    ? sales.map((row, rowIndex) => rowIndex === existingIndex ? { ...row, ...voided } : row)
    : [...sales, voided]
  writeJson(SALES_KEY, nextSales)
  writeJson(QUEUE_KEY, readJson(QUEUE_KEY, []).filter(entry => {
    if (isVoidUpdateEntry(entry)) return String(entry.saleId) !== String(saleId)
    return !entry?.sale || !sameSaleIdentity(entry.sale, sale)
  }))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sale-updated', { detail: { saleId, status: 'voided', voidCentralVerified: true } }))
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
    updated.attempts = Number(row.attemptCount ?? row.attempts ?? 0) + 1
    updated.attemptCount = updated.attempts
    updated.lastAttemptAt = attemptedAt
    updated.lastError = ''
    updated.lastErrorCode = ''
    return updated
  })
  if (updated) writeJson(QUEUE_KEY, nextQueue)
  return updated || { ...entry, attempts: Number(entry.attempts || 0) + 1, lastAttemptAt: attemptedAt, lastError: '', lastErrorCode: '' }
}
