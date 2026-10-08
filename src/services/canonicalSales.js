const text = value => String(value ?? '').trim()
const amount = value => Number.isFinite(Number(value)) ? Number(value) : 0

export const saleIdOf = sale => text(sale?.saleId || sale?.id)
export const operationKeyOf = sale => text(sale?.operationKey || sale?.operation_key)
export const saleDayIdOf = sale => text(sale?.operationalDayId || sale?.operational_day_id || sale?.shiftId || sale?.shift_id)
export const saleBusinessDateOf = sale => text(sale?.businessDate || sale?.business_date)
export const salePaymentMethodOf = sale => text(sale?.paymentMethod || sale?.payment_method || sale?.payment?.method)
export const saleGrossOf = sale => amount(sale?.gross ?? sale?.subtotal ?? sale?.total)
export const saleDiscountOf = sale => amount(sale?.discount ?? sale?.discount_amount)
export const saleNetOf = sale => amount(sale?.net ?? sale?.total ?? sale?.total_after_discount ?? sale?.subtotal) || saleGrossOf(sale) - saleDiscountOf(sale)
export const isCanonicalSaleEligible = sale => {
  const status = text(sale?.status).toLowerCase()
  return !sale?.voided && !['cancelled', 'canceled', 'voided', 'abandoned', 'draft', 'باطل', 'ملغي'].includes(status)
}

export const belongsToOperationalDay = (sale, day) => {
  if (!day?.id || !day?.businessDate || !isCanonicalSaleEligible(sale)) return false
  const dayId = saleDayIdOf(sale)
  return dayId ? dayId === text(day.id) : saleBusinessDateOf(sale) === text(day.businessDate)
}

const identityOf = sale => saleIdOf(sale) || operationKeyOf(sale)

export const canonicalSalesForOperationalDay = ({ localSales = [], centralSales = [], operationalDay } = {}) => {
  const local = (Array.isArray(localSales) ? localSales : []).filter(sale => belongsToOperationalDay(sale, operationalDay))
  const central = (Array.isArray(centralSales) ? centralSales : []).filter(sale => belongsToOperationalDay(sale, operationalDay))
  const rows = new Map()
  for (const sale of local) if (identityOf(sale)) rows.set(identityOf(sale), { ...sale, _source: 'local' })
  // Central is authoritative for an existing identity, but local-only rows stay
  // visible so a pending sale cannot disappear from reconciliation.
  for (const sale of central) if (identityOf(sale)) rows.set(identityOf(sale), { ...sale, _source: 'central' })
  return [...rows.values()]
}

export const summarizeCanonicalSales = (sales = []) => {
  const rows = Array.isArray(sales) ? sales : []
  const gross = rows.reduce((sum, sale) => sum + saleGrossOf(sale), 0)
  const discount = rows.reduce((sum, sale) => sum + saleDiscountOf(sale), 0)
  const net = rows.reduce((sum, sale) => sum + saleNetOf(sale), 0)
  const cash = rows.filter(sale => salePaymentMethodOf(sale) === 'cash').reduce((sum, sale) => sum + saleNetOf(sale), 0)
  const electronic = rows.filter(sale => salePaymentMethodOf(sale) === 'electronic').reduce((sum, sale) => sum + saleNetOf(sale), 0)
  return { count: rows.length, gross, discount, net, cash, electronic, ids: rows.map(saleIdOf).filter(Boolean), salesBalanced: gross - discount === net, paymentsBalanced: cash + electronic === net }
}

export const reconcileCanonicalSales = ({ localSales = [], centralSales = [], operationalDay } = {}) => {
  const local = (Array.isArray(localSales) ? localSales : []).filter(sale => belongsToOperationalDay(sale, operationalDay))
  const central = (Array.isArray(centralSales) ? centralSales : []).filter(sale => belongsToOperationalDay(sale, operationalDay))
  const canonical = canonicalSalesForOperationalDay({ localSales: local, centralSales: central, operationalDay })
  const localSummary = summarizeCanonicalSales(local)
  const centralSummary = summarizeCanonicalSales(central)
  const localIds = new Set(localSummary.ids)
  const centralIds = new Set(centralSummary.ids)
  const missingLocalIds = centralSummary.ids.filter(id => !localIds.has(id))
  const missingCentralIds = localSummary.ids.filter(id => !centralIds.has(id))
  const totalsMatch = ['count', 'gross', 'discount', 'net', 'cash', 'electronic'].every(key => localSummary[key] === centralSummary[key])
  const canonicalSummary = summarizeCanonicalSales(canonical)
  return { local, central, canonical, localSummary, centralSummary, canonicalSummary, missingLocalIds, missingCentralIds, totalsMatch, allowed: totalsMatch && localSummary.salesBalanced && localSummary.paymentsBalanced && centralSummary.salesBalanced && centralSummary.paymentsBalanced && missingLocalIds.length === 0 && missingCentralIds.length === 0 }
}
