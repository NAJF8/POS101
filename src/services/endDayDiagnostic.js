import { financialFingerprint, isSaleSyncEligible, salePayloadMatches } from './salesSyncQueue.js'
import { reconcilePreCloseSales } from './preCloseReconciliation.js'

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
  if (number(local?.discount) !== number(central?.discount)) fields.push('discount')
  if (text(local?.paymentMethod || local?.payment?.method) !== text(central?.paymentMethod || central?.payment?.method)) fields.push('paymentMethod')
  if (number(local?.net ?? local?.total ?? local?.subtotal) !== number(central?.net ?? central?.total ?? central?.subtotal)) fields.push('net')
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

export const buildEndDayDiagnostic = ({ localSales = [], queueEntries = [], centralSales = [], operationalDay = null, openOrderCount = 0, preCloseGuard = null } = {}) => {
  const local = (Array.isArray(localSales) ? localSales : []).filter(sale => belongsToCurrentDay(sale, operationalDay) && isSaleSyncEligible(sale))
  const queue = (Array.isArray(queueEntries) ? queueEntries : []).filter(entry => entry?.sale && belongsToCurrentDay(entry.sale, operationalDay) && isSaleSyncEligible(entry.sale))
  const central = Array.isArray(centralSales) ? centralSales : []
  const reconciliation = reconcilePreCloseSales({ localSales: local, queueEntries: queue, centralSales: central, operationalDay, openOrderCount })
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
  return {
    status: preCloseGuard?.state || (blockers.length || Number(openOrderCount) ? 'real-pending' : 'verified'),
    message: preCloseGuard?.message || '',
    pendingQueue: reconciliation.pendingQueue,
    openOrderCount: Number(openOrderCount) || 0,
    openOrderFlag: (Number(openOrderCount) || 0) > 0,
    reconciliationState: preCloseGuard?.loading ? 'loading' : 'completed',
    blockers,
  }
}

export const diagnosticFingerprint = sale => financialFingerprint(sale)
