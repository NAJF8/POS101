import { isSaleSyncEligible, salePayloadMatches, KNOWN_MANUAL_REVIEW_SALE_1056 } from './salesSyncQueue.js'

const text = value => String(value ?? '').trim()
const saleIdOf = sale => text(sale?.saleId || sale?.id)
const operationKeyOf = sale => text(sale?.operationKey || sale?.operation_key)
const rowsOf = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []

export const ORDER_1309_SALE_ID = '809aa958-256d-44a8-83bd-33c8b82dca56'
export const ORDER_1309_NUMBER = 1309
export const KNOWN_CLOSED_BUSINESS_DATE = '2026-10-07'

const parseMaybeJson = value => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}

export const normalizeBackupSale = sale => ({
  ...sale,
  saleId: saleIdOf(sale),
  id: saleIdOf(sale),
  operationKey: operationKeyOf(sale),
  paymentMethod: text(sale?.paymentMethod || sale?.payment?.method),
  businessDate: text(sale?.businessDate),
  operationalDayId: text(sale?.operationalDayId || sale?.operational_day_id),
})

export const parseBackupSales = input => {
  const parsed = parseMaybeJson(input)
  if (!parsed) throw new Error('ملف النسخة الاحتياطية ليس JSON صالحاً.')
  const localStorage = parsed?.localStorage || parsed?.storage || {}
  const candidates = [
    Array.isArray(parsed) ? parsed : null,
    parsed?.sales,
    parsed?.['pos101.sales'],
    parseMaybeJson(localStorage?.['pos101.sales']),
    parsed?.data?.sales,
  ]
  const rows = candidates.flatMap(value => rowsOf(value)).filter(row => row && typeof row === 'object')
  const seen = new Set()
  return rows.map(normalizeBackupSale).filter(sale => {
    const key = saleIdOf(sale) || `${sale.operationKey}|${sale.orderNumber}|${sale.businessDate}|${sale.total}`
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const firstArray = (...values) => values.find(value => Array.isArray(value)) || []

export const parseBackupRecoveryInput = input => {
  const parsed = parseMaybeJson(input)
  if (!parsed || typeof parsed !== 'object') throw new Error('ملف التشخيص/النسخة الاحتياطية ليس JSON صالحاً.')
  const localStorage = parsed?.localStorage || parsed?.storage || {}
  const localSalesRaw = parseMaybeJson(localStorage?.['pos101.sales'])
  const queueRaw = parseMaybeJson(localStorage?.['pos101.syncQueue'])
  const syncQueueItems = firstArray(Array.isArray(parsed) ? parsed : null, parsed?.syncQueueItems, parsed?.syncQueue, parsed?.['pos101.syncQueue'], parsed?.data?.syncQueue, localSalesRaw?.syncQueue, queueRaw)
  const sourceBusinessDate = String(parsed?.businessDate || parsed?.operationalDay?.businessDate || '').trim()
  const sourceOperationalDayId = String(parsed?.operationalDayId || parsed?.operationalDay?.id || '').trim()
  const parsedSales = parseBackupSales(parsed)
  const queueSales = syncQueueItems
    .map(entry => ({ ...(entry?.sale || entry?.payload || entry), businessDate: (entry?.sale || entry?.payload || entry)?.businessDate || sourceBusinessDate, operationalDayId: (entry?.sale || entry?.payload || entry)?.operationalDayId || sourceOperationalDayId }))
    .filter(row => row && typeof row === 'object' && (saleIdOf(row) || row.orderNumber != null || row.total != null))
  const sales = parseBackupSales({ sales: [...parsedSales, ...queueSales] })
  const businessDate = String(sourceBusinessDate || sales.find(sale => sale.businessDate)?.businessDate || '').trim()
  const operationalDayId = String(sourceOperationalDayId || sales.find(sale => sale.operationalDayId)?.operationalDayId || '').trim()
  return { sales, syncQueueItems, businessDate, operationalDayId, source: parsed }
}

// Keep one canonical payload per saleId, while retaining queue duplicates for
// the repair report. A duplicate is only safe to resolve after Firebase
// readback (or a successful one-time recovery) proves the canonical sale.
export const buildRecoveryCandidates = ({ sales = [], syncQueueItems = [] } = {}) => {
  const bySaleId = new Map()
  const invalidQueueItems = []
  const add = (raw, source = 'backup') => {
    const row = normalizeBackupSale(raw)
    const id = saleIdOf(row)
    if (!id) {
      if (source === 'queue') invalidQueueItems.push({ item: raw, classification: 'INVALID_QUEUE_MANUAL_REVIEW', reason: 'لا يوجد saleId قابل للاسترداد.' })
      return
    }
    const current = bySaleId.get(id)
    if (!current || (!current.operationKey && row.operationKey) || (!current.items?.length && row.items?.length)) {
      bySaleId.set(id, { ...row, candidateSources: [source], queueDuplicateCount: current?.queueDuplicateCount || 0 })
      return
    }
    const sources = [...new Set([...(current.candidateSources || []), source])]
    bySaleId.set(id, { ...current, candidateSources: sources, queueDuplicateCount: current.queueDuplicateCount + (source === 'queue' ? 1 : 0) })
  }
  ;(Array.isArray(sales) ? sales : []).forEach(row => add(row, 'sales'))
  ;(Array.isArray(syncQueueItems) ? syncQueueItems : []).forEach(entry => add(entry?.sale || entry?.payload || entry, 'queue'))
  return { candidates: [...bySaleId.values()], invalidQueueItems }
}

export const summarizeBackupSales = sales => {
  const rows = Array.isArray(sales) ? sales : []
  const byDay = new Map()
  for (const sale of rows) {
    const day = sale.businessDate || 'غير محدد'
    const current = byDay.get(day) || { businessDate: day, count: 0, total: 0 }
    current.count += 1
    current.total += Number(sale.total ?? sale.subtotal) || 0
    byDay.set(day, current)
  }
  return {
    count: rows.length,
    total: rows.reduce((sum, sale) => sum + (Number(sale.total ?? sale.subtotal) || 0), 0),
    synced: rows.filter(sale => sale.syncStatus === 'synced' || sale.status === 'synced').length,
    pending: rows.filter(sale => sale.syncStatus !== 'synced' && sale.status !== 'synced' && sale.status !== 'voided').length,
    voided: rows.filter(sale => sale.status === 'voided' || sale.status === 'cancelled').length,
    unverified: rows.filter(sale => sale.centralVerified !== true).length,
    days: [...byDay.values()].sort((a, b) => String(a.businessDate).localeCompare(String(b.businessDate))),
  }
}

export const classifyBackupSale = ({ sale, centralSales = [], openDay = null, quarantinedSaleIds = [] } = {}) => {
  const row = normalizeBackupSale(sale)
  const id = saleIdOf(row)
  const sameId = centralSales.filter(remote => saleIdOf(remote) === id)
  const sameOperation = centralSales.filter(remote => operationKeyOf(remote) === row.operationKey && row.operationKey)
  const sameOrder = centralSales.filter(remote => String(remote?.orderNumber ?? '') === String(row?.orderNumber ?? '')
    && text(remote?.businessDate) === row.businessDate
    && text(remote?.operationalDayId || remote?.operational_day_id) === row.operationalDayId)
  const exact = sameId.find(remote => salePayloadMatches(row, remote))
  const invalid = !isSaleSyncEligible(row) || row.status === 'voided' || row.status === 'cancelled'
  const alreadySynced = row.syncStatus === 'synced' || row.status === 'synced' || row.centralVerified === true
  const quarantined = id === KNOWN_MANUAL_REVIEW_SALE_1056 || quarantinedSaleIds.includes(id)
  const closedRecoveryDay = row.businessDate === KNOWN_CLOSED_BUSINESS_DATE
  let classification = 'MISSING_SAFE_TO_RECOVER'
  let reason = 'لم يوجد saleId أو operationKey أو رقم طلب متعارض، واليوم التشغيلي مفتوح.'
  if (quarantined) { classification = 'SKIP'; reason = 'المبيعة محجوزة للمراجعة اليدوية.' }
  else if (closedRecoveryDay && !exact) { classification = 'CONFLICT'; reason = 'يوم 2026-10-07 مغلق؛ لا كتابة أو تنظيف تلقائي.' }
  else if (exact) { classification = 'EXISTS_EXACT_MATCH'; reason = 'المبيعة المركزية تطابق saleId والبصمة المالية.' }
  else if (invalid) { classification = 'SKIP'; reason = 'payload غير صالح أو المبيعة مبطلة.' }
  else if (alreadySynced) { classification = 'SKIP'; reason = 'المبيعة معلّمة محلياً كمزامنة؛ لا يجوز رفعها دون مراجعة.' }
  else if (sameId.length) { classification = 'CONFLICT'; reason = 'saleId موجود مركزياً لكن payload مختلف.' }
  else if (sameOperation.length || sameOrder.length) { classification = 'CONFLICT'; reason = sameOperation.length ? 'operationKey متعارض.' : 'رقم الطلب متعارض في نفس اليوم التشغيلي.' }
  else if (!openDay || openDay.status !== 'open' || text(openDay.businessDate) !== row.businessDate || text(openDay.id || openDay.operationalDayId) !== row.operationalDayId) {
    classification = 'CONFLICT'
    reason = 'اليوم التشغيلي ليس مفتوحاً أو لا يطابق المبيعة.'
  }
  return { sale: row, classification, reason, centralSale: exact || sameId[0] || sameOperation[0] || sameOrder[0] || null, duplicateSaleId: sameId.length > 1, duplicateOrderNumber: sameOrder.some(remote => saleIdOf(remote) !== id), firebasePath: id ? `pos101_sales/${id}` : '' }
}
