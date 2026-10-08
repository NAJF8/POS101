import { financialFingerprint, isSaleSyncEligible, isVoidedSale, salePayloadMatches } from './salesSyncQueue.js'
import { reconcilePreCloseSales } from './preCloseReconciliation.js'
import { reconcileCanonicalSales } from './canonicalSales.js'

const text = value => String(value ?? '').trim()
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const saleIdOf = sale => text(sale?.saleId || sale?.id)
const operationKeyOf = sale => text(sale?.operationKey || sale?.operation_key)
const itemsOf = sale => Array.isArray(sale?.items)
  ? sale.items
  : Array.isArray(sale?.order?.items) ? sale.order.items : []
const stable = value => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out }, {})
  return value
}
const normalizedItems = sale => itemsOf(sale).map(item => ({
  id: text(item?.id || item?.productId || item?.product_id || item?.sku || item?.name),
  quantity: number(item?.quantity),
  unitPrice: number(item?.unitPrice ?? item?.price ?? item?.unit_price),
  lineTotal: number(item?.lineTotal ?? item?.total ?? (number(item?.quantity) * number(item?.unitPrice ?? item?.price ?? item?.unit_price))),
})).sort((left, right) => `${left.id}|${left.unitPrice}|${left.quantity}`.localeCompare(`${right.id}|${right.unitPrice}|${right.quantity}`))

export const diagnosticMismatchFields = (local, central) => {
  if (!central) return []
  const fields = []
  if (JSON.stringify(stable(normalizedItems(local))) !== JSON.stringify(stable(normalizedItems(central)))) fields.push('items')
  if (number(local?.gross ?? local?.subtotal) !== number(central?.gross ?? central?.subtotal)) fields.push('gross')
  if (number(local?.discount) !== number(central?.discount)) fields.push('discount')
  if (text(local?.paymentMethod || local?.payment?.method) !== text(central?.paymentMethod || central?.payment?.method)) fields.push('paymentMethod')
  if (number(local?.net ?? local?.total ?? local?.subtotal) !== number(central?.net ?? central?.total ?? central?.subtotal)) fields.push('net')
  if (number(local?.cashAmount ?? local?.payment?.cashAmount) !== number(central?.cashAmount ?? central?.payment?.cashAmount)) fields.push('cashAmount')
  if (number(local?.electronicAmount ?? local?.payment?.electronicAmount) !== number(central?.electronicAmount ?? central?.payment?.electronicAmount)) fields.push('electronicAmount')
  if (text(local?.businessDate) !== text(central?.businessDate)) fields.push('businessDate')
  if (text(local?.operationalDayId || local?.operational_day_id) !== text(central?.operationalDayId || central?.operational_day_id)) fields.push('operationalDayId')
  if (operationKeyOf(local) !== operationKeyOf(central)) fields.push('operationKey')
  return fields
}

const belongsToCurrentDay = (sale, day) => Boolean(
  day?.id && day?.businessDate
  && text(sale?.operationalDayId || sale?.operational_day_id || sale?.shiftId || sale?.shift_id) === text(day.id)
  && text(sale?.businessDate) === text(day.businessDate)
)
const sameIdentity = (left, right) => Boolean(
  (saleIdOf(left) && saleIdOf(left) === saleIdOf(right))
  || (operationKeyOf(left) && operationKeyOf(left) === operationKeyOf(right))
)

export const buildEndDayDiagnostic = ({ localSales = [], queueEntries = [], voidQueueEntries = [], centralSales = [], operationalDay = null, localOperationalDay = null, centralOperationalDay = null, openOrderCount = 0, preCloseGuard = null, liveCommit = '', liveBundle = '' } = {}) => {
  const localRows = (Array.isArray(localSales) ? localSales : []).filter(sale => belongsToCurrentDay(sale, operationalDay))
  const currentQueueEntries = (Array.isArray(queueEntries) ? queueEntries : []).filter(entry => entry?.sale && belongsToCurrentDay(entry.sale, operationalDay))
  const local = localRows.filter(sale => isSaleSyncEligible(sale))
  const queue = currentQueueEntries.filter(entry => entry?.sale && isSaleSyncEligible(entry.sale))
  const currentVoidQueue = (Array.isArray(voidQueueEntries) ? voidQueueEntries : []).filter(entry => belongsToCurrentDay(entry, operationalDay))
  const central = Array.isArray(centralSales) ? centralSales : []
  const reconciliation = reconcilePreCloseSales({ localSales, queueEntries: queue, voidQueueEntries, centralSales: central, operationalDay, openOrderCount })
  const financialReconciliation = reconcileCanonicalSales({ localSales, centralSales, operationalDay })
  const centrallyVerified = sale => central.some(remote => salePayloadMatches(sale, remote))
  const candidates = [...local, ...queue.map(entry => entry.sale)].filter(sale => !centrallyVerified(sale))
  const seen = new Set()
  const blockers = []
  for (const sale of candidates) {
    const key = [saleIdOf(sale) && `id:${saleIdOf(sale)}`, operationKeyOf(sale) && `op:${operationKeyOf(sale)}`].filter(Boolean).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const localSale = local.find(row => sameIdentity(row, sale)) || sale
    const queueRows = queue.filter(entry => sameIdentity(entry.sale, sale))
    const centralSale = central.find(row => sameIdentity(row, sale)) || null
    const source = local.some(row => sameIdentity(row, sale)) && queueRows.length ? 'BOTH' : queueRows.length ? 'SYNC_QUEUE' : 'LOCAL_SALE'
    blockers.push({
      orderNumber: localSale?.orderNumber ?? sale?.orderNumber ?? '',
      saleId: saleIdOf(localSale || sale),
      businessDate: text(localSale?.businessDate || sale?.businessDate),
      operationalDayId: text(localSale?.operationalDayId || localSale?.operational_day_id || sale?.operationalDayId || sale?.operational_day_id),
      operationKey: operationKeyOf(localSale || sale),
      localStatus: text(localSale?.status || sale?.status),
      localSyncStatus: text(localSale?.syncStatus || sale?.syncStatus),
      centralVerified: localSale?.centralVerified === true,
      queueEntryExists: queueRows.length > 0,
      source,
      centralExists: Boolean(centralSale),
      centralStatus: text(centralSale?.status),
      centralSyncStatus: text(centralSale?.syncStatus),
      salePayloadMatches: centralSale ? salePayloadMatches(localSale, centralSale) : false,
      mismatchFields: centralSale ? diagnosticMismatchFields(localSale, centralSale) : [],
      queueEntries: queueRows.map(entry => ({
        operationType: text(entry?.operationType || entry?.type || entry?.kind || 'sale'),
        id: text(entry?.queueKey || entry?.saleId || entry?.sale?.saleId || entry?.sale?.id),
        businessDate: text(entry?.businessDate || entry?.sale?.businessDate),
        operationalDayId: text(entry?.operationalDayId || entry?.sale?.operationalDayId || entry?.sale?.operational_day_id),
      })),
    })
  }
  const unresolvedVoids = [
    ...localRows.filter(sale => isVoidedSale(sale) && sale?.queueResolution !== 'voided_before_central_sync'),
    ...currentVoidQueue.map(entry => ({ saleId: entry.saleId, id: entry.saleId, orderNumber: entry.orderNumber, businessDate: entry.businessDate, operationalDayId: entry.operationalDayId, status: 'void_pending_sync' })),
  ].filter(sale => {
    const remote = central.find(row => sameIdentity(row, sale))
    return !remote || !isVoidedSale(remote)
  })
  const unresolvedVoidIds = new Set(unresolvedVoids.map(sale => saleIdOf(sale)).filter(Boolean))
  const localDay = localOperationalDay || operationalDay || null
  const centralDay = centralOperationalDay || null
  const dayMatches = Boolean(localDay?.id && centralDay?.id && String(localDay.id) === String(centralDay.id) && String(localDay.businessDate || '') === String(centralDay.businessDate || ''))
  const activeLocalRows = localRows.filter(sale => !isVoidedSale(sale))
  const allActiveLocalCentralVerified = activeLocalRows.every(sale => sale?.centralVerified === true)
  const centralDayOpenBeforeClose = Boolean(localDay?.status === 'open' && centralDay?.status === 'open' && dayMatches)
  const blockingItems = blockers.length + unresolvedVoidIds.size + (reconciliation.activeTotalsMatch ? 0 : 1) + (allActiveLocalCentralVerified ? 0 : 1) + (centralDayOpenBeforeClose ? 0 : 1)
  const endDayReady = Boolean(centralDayOpenBeforeClose && reconciliation.allowed && financialReconciliation.allowed && Number(openOrderCount) === 0 && allActiveLocalCentralVerified && unresolvedVoidIds.size === 0)
  const resolvedVoidedBeforeSync = new Set(localRows.filter(sale => sale?.queueResolution === 'voided_before_central_sync').map(sale => saleIdOf(sale)).filter(Boolean)).size
  const saleAllowed = Boolean(centralDay?.status === 'open' && localDay?.status === 'open' && dayMatches)
  const blockReason = !centralDay ? 'CENTRAL_DAY_UNAVAILABLE' : centralDay.status !== 'open' ? 'CENTRAL_DAY_CLOSED' : !dayMatches ? 'LOCAL_CENTRAL_DAY_MISMATCH' : !allActiveLocalCentralVerified ? 'ACTIVE_LOCAL_NOT_CENTRAL_VERIFIED' : unresolvedVoidIds.size ? 'VOID_PENDING' : !reconciliation.activeTotalsMatch ? 'LOCAL_FIREBASE_ACTIVE_MISMATCH' : reconciliation.pendingQueue ? 'REAL_PENDING_QUEUE' : Number(openOrderCount) ? 'OPEN_ORDER' : ''
  return {
    LIVE_COMMIT: liveCommit,
    LIVE_BUNDLE: liveBundle,
    businessDate: operationalDay?.businessDate || '',
    operationalDayId: operationalDay?.id || '',
    LOCAL_OPERATIONAL_DAY_ID: localDay?.id || '',
    LOCAL_BUSINESS_DATE: localDay?.businessDate || '',
    LOCAL_DAY_STATUS: localDay?.status || 'closed',
    CENTRAL_OPERATIONAL_DAY_ID: centralDay?.id || '',
    CENTRAL_BUSINESS_DATE: centralDay?.businessDate || '',
    CENTRAL_DAY_STATUS: centralDay?.status || 'unavailable',
    LOCAL_CENTRAL_DAY_MATCH: dayMatches ? 'PASS' : 'FAIL',
    SALE_ALLOWED: saleAllowed ? 'YES' : 'NO',
    BLOCK_REASON: blockReason,
    localActiveCount: reconciliation.localActiveCount,
    localActiveTotal: reconciliation.localActiveTotal,
    firebaseActiveCount: reconciliation.centralActiveCount,
    firebaseActiveTotal: reconciliation.centralActiveTotal,
    LOCAL_ACTIVE_COUNT: reconciliation.localActiveCount,
    LOCAL_ACTIVE_TOTAL: reconciliation.localActiveTotal,
    FIREBASE_ACTIVE_COUNT: reconciliation.centralActiveCount,
    FIREBASE_ACTIVE_TOTAL: reconciliation.centralActiveTotal,
    LOCAL_FIREBASE_ACTIVE_MATCH: reconciliation.activeTotalsMatch ? 'PASS' : 'FAIL',
    ACTIVE_LOCAL_CENTRAL_VERIFIED: allActiveLocalCentralVerified ? 'PASS' : 'FAIL',
    pendingSaleWrite: currentQueueEntries.filter(entry => entry?.type === 'sale_write' || entry?.kind === 'sale' || !entry?.type).length,
    pendingVoidUpdate: currentVoidQueue.length,
    PENDING_SALE_WRITE: currentQueueEntries.filter(entry => entry?.type === 'sale_write' || entry?.kind === 'sale' || !entry?.type).length,
    PENDING_VOID_UPDATE: currentVoidQueue.length,
    voidedBeforeSyncResolved: resolvedVoidedBeforeSync,
    queueItems: currentQueueEntries.length + currentVoidQueue.length,
    QUEUE_ITEMS: currentQueueEntries.length + currentVoidQueue.length,
    blockingItems,
    END_DAY_READY: endDayReady ? 'YES' : 'NO',
    status: preCloseGuard?.state || (blockingItems || Number(openOrderCount) ? 'real-pending' : 'verified'),
    message: preCloseGuard?.message || '',
    pendingQueue: reconciliation.pendingQueue,
    OPEN_SALES_QUEUE_COUNT: reconciliation.pendingQueue,
    openOrderCount: Number(openOrderCount) || 0,
    openOrderFlag: (Number(openOrderCount) || 0) > 0,
    reconciliationState: preCloseGuard?.loading ? 'loading' : 'completed',
    blockers,
    unresolvedVoids: [...unresolvedVoidIds],
    financialReconciliation,
  }
}

export const diagnosticFingerprint = sale => financialFingerprint(sale)
