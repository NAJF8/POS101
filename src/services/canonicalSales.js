import { actualCashDiscountOf } from './reportSales.js'

const text = value => String(value ?? '').trim()
const amount = value => Number.isFinite(Number(value)) ? Number(value) : 0

export const saleIdOf = sale => text(sale?.saleId || sale?.id)
export const operationKeyOf = sale => text(sale?.operationKey || sale?.operation_key)
export const saleDayIdOf = sale => text(sale?.operationalDayId || sale?.operational_day_id || sale?.shiftId || sale?.shift_id)
export const saleBusinessDateOf = sale => text(sale?.businessDate || sale?.business_date)
export const salePaymentMethodOf = sale => text(sale?.paymentMethod || sale?.payment_method || sale?.payment?.method)
export const saleGrossOf = sale => amount(sale?.gross ?? sale?.subtotal ?? (amount(sale?.total) + actualCashDiscountOf(sale)))
export const saleDiscountOf = sale => actualCashDiscountOf(sale)
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

export const normalizeSaleForReconciliation = sale => {
  if (!sale || typeof sale !== 'object') return null
  const id = saleIdOf(sale)
  const operationKey = operationKeyOf(sale)
  const orderNumber = Number.isFinite(Number(sale?.orderNumber)) ? Number(sale.orderNumber) : null
  const businessDate = saleBusinessDateOf(sale)
  const operationalDayId = saleDayIdOf(sale)
  const discount = saleDiscountOf(sale)
  const subtotal = saleGrossOf(sale)
  const total = saleNetOf(sale)
  const paymentMethod = salePaymentMethodOf(sale) || 'cash'
  const isVoided = !isCanonicalSaleEligible(sale)
  const tax = amount(sale?.tax ?? sale?.tax_amount ?? 0)
  const service = amount(sale?.service ?? sale?.service_charge ?? sale?.serviceCharge ?? 0)
  const status = text(sale?.status || (isVoided ? 'voided' : 'completed')).toLowerCase()
  const refundStatus = text(sale?.refundStatus || sale?.refund_status || '')
  return {
    ...sale,
    id,
    saleId: id,
    operationKey,
    orderNumber,
    businessDate,
    operationalDayId,
    subtotal,
    gross: subtotal,
    discount,
    tax,
    service,
    total,
    net: total,
    paymentMethod,
    voided: isVoided,
    status,
    refundStatus,
  }
}

const identityOf = sale => saleIdOf(sale) || operationKeyOf(sale)

export const canonicalSalesForOperationalDay = ({ localSales = [], centralSales = [], operationalDay } = {}) => {
  const local = (Array.isArray(localSales) ? localSales : []).map(normalizeSaleForReconciliation).filter(sale => belongsToOperationalDay(sale, operationalDay))
  const central = (Array.isArray(centralSales) ? centralSales : []).map(normalizeSaleForReconciliation).filter(sale => belongsToOperationalDay(sale, operationalDay))
  const rows = new Map()
  for (const sale of local) if (identityOf(sale)) rows.set(identityOf(sale), { ...sale, _source: 'local' })
  // Central is authoritative for an existing identity, but local-only rows stay
  // visible so a pending sale cannot disappear from reconciliation.
  for (const sale of central) if (identityOf(sale)) rows.set(identityOf(sale), { ...sale, _source: 'central' })
  return [...rows.values()]
}

export const summarizeCanonicalSales = (sales = []) => {
  const rows = (Array.isArray(sales) ? sales : []).map(normalizeSaleForReconciliation).filter(Boolean)
  const gross = rows.reduce((sum, sale) => sum + saleGrossOf(sale), 0)
  const discount = rows.reduce((sum, sale) => sum + saleDiscountOf(sale), 0)
  const net = rows.reduce((sum, sale) => sum + saleNetOf(sale), 0)
  const cash = rows.filter(sale => salePaymentMethodOf(sale) === 'cash').reduce((sum, sale) => sum + saleNetOf(sale), 0)
  const electronic = rows.filter(sale => salePaymentMethodOf(sale) === 'electronic').reduce((sum, sale) => sum + saleNetOf(sale), 0)
  return { count: rows.length, gross, discount, net, cash, electronic, ids: rows.map(saleIdOf).filter(Boolean), salesBalanced: gross - discount === net, paymentsBalanced: cash + electronic === net }
}

const formatMoney = val => Number(val || 0).toLocaleString('en-US')

export const reconcileCanonicalSales = ({ localSales = [], centralSales = [], operationalDay } = {}) => {
  const local = (Array.isArray(localSales) ? localSales : []).map(normalizeSaleForReconciliation).filter(sale => belongsToOperationalDay(sale, operationalDay))
  const central = (Array.isArray(centralSales) ? centralSales : []).map(normalizeSaleForReconciliation).filter(sale => belongsToOperationalDay(sale, operationalDay))
  const canonical = canonicalSalesForOperationalDay({ localSales: local, centralSales: central, operationalDay })
  const localSummary = summarizeCanonicalSales(local)
  const centralSummary = summarizeCanonicalSales(central)
  const localMap = new Map()
  for (const s of local) {
    const key = identityOf(s)
    if (key) localMap.set(key, s)
  }
  const centralMap = new Map()
  for (const s of central) {
    const key = identityOf(s)
    if (key) centralMap.set(key, s)
  }
  const localIds = new Set(localSummary.ids)
  const centralIds = new Set(centralSummary.ids)
  const missingLocalIds = centralSummary.ids.filter(id => !localIds.has(id))
  const missingCentralIds = localSummary.ids.filter(id => !centralIds.has(id))

  const differences = []
  for (const [id, localSale] of localMap) {
    const remoteSale = centralMap.get(id)
    if (remoteSale) {
      const discDiff = saleDiscountOf(localSale) - saleDiscountOf(remoteSale)
      const netDiff = saleNetOf(localSale) - saleNetOf(remoteSale)
      const grossDiff = saleGrossOf(localSale) - saleGrossOf(remoteSale)
      if (discDiff !== 0 || netDiff !== 0 || grossDiff !== 0 || salePaymentMethodOf(localSale) !== salePaymentMethodOf(remoteSale)) {
        differences.push({
          saleId: id,
          orderNumber: localSale.orderNumber ?? remoteSale.orderNumber ?? null,
          localDiscount: saleDiscountOf(localSale),
          centralDiscount: saleDiscountOf(remoteSale),
          discountDifference: discDiff,
          localNet: saleNetOf(localSale),
          centralNet: saleNetOf(remoteSale),
          netDifference: netDiff,
          localGross: saleGrossOf(localSale),
          centralGross: saleGrossOf(remoteSale),
          grossDifference: grossDiff,
          localPaymentMethod: salePaymentMethodOf(localSale),
          centralPaymentMethod: salePaymentMethodOf(remoteSale),
        })
      }
    }
  }

  const totalsMatch = ['count', 'gross', 'discount', 'net', 'cash', 'electronic'].every(key => localSummary[key] === centralSummary[key])
  const discountDifference = localSummary.discount - centralSummary.discount
  const netDifference = localSummary.net - centralSummary.net
  const countDifference = localSummary.count - centralSummary.count
  const allowed = totalsMatch && localSummary.salesBalanced && localSummary.paymentsBalanced && centralSummary.salesBalanced && centralSummary.paymentsBalanced && missingLocalIds.length === 0 && missingCentralIds.length === 0 && differences.length === 0
  const canonicalSummary = summarizeCanonicalSales(canonical)

  let reason = ''
  let message = ''
  if (!allowed) {
    if (countDifference !== 0) {
      reason = 'LOCAL_CENTRAL_SALES_COUNT_MISMATCH'
      message = `يوجد اختلاف في عدد المبيعات (المحلي: ${localSummary.count}، المركزي: ${centralSummary.count}).`
    } else if (discountDifference !== 0) {
      reason = 'DISCOUNT_MISMATCH'
      message = `يوجد اختلاف في خصومات المبيعات قبل التسوية.\nالمحلي: ${formatMoney(localSummary.discount)} د.ع\nالمركزي: ${formatMoney(centralSummary.discount)} د.ع\nالفرق: ${formatMoney(Math.abs(discountDifference))} د.ع`
    } else if (netDifference !== 0) {
      reason = 'LOCAL_CENTRAL_SALES_TOTAL_MISMATCH'
      message = `يوجد اختلاف في صافي المبيعات (المحلي: ${formatMoney(localSummary.net)} د.ع، المركزي: ${formatMoney(centralSummary.net)} د.ع).`
    } else if (missingLocalIds.length > 0 || missingCentralIds.length > 0 || differences.length > 0) {
      reason = 'CENTRAL_SALES_CANONICAL_MISMATCH'
      message = 'توجد فروقات بنيوية بين المبيعات المحلية والمركزية.'
    } else if (!localSummary.salesBalanced || !centralSummary.salesBalanced) {
      reason = 'CENTRAL_SALES_CANONICAL_MISMATCH'
      message = 'المبيعات غير متوازنة محاسبيًا بين الإجمالي والخصم والصافي.'
    } else {
      reason = 'CENTRAL_SALES_CANONICAL_MISMATCH'
      message = 'تعذر مطابقة المبيعات المحلية والمركزية.'
    }
  }

  return {
    local,
    central,
    canonical,
    localSummary,
    centralSummary,
    canonicalSummary,
    missingLocalIds,
    missingCentralIds,
    totalsMatch,
    allowed,
    reason,
    message,
    discountDifference,
    netDifference,
    countDifference,
    differences,
  }
}
