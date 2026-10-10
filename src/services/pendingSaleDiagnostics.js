const text = value => String(value ?? '').trim()
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0

export const PENDING_DIAGNOSTIC_STATUS = 'pending_local_confirmation'
export const RESOLVED_DIAGNOSTIC_STATUS = 'resolved'

const saleItems = sale => Array.isArray(sale?.items)
  ? sale.items
  : Array.isArray(sale?.order?.items) ? sale.order.items : []

export const diagnosticKeyFor = ({ operationKey = '', saleId = '' } = {}) => {
  const identity = text(operationKey) || text(saleId)
  return encodeURIComponent(identity).replace(/[.#$\[\]/]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

export const diagnosticIdentity = value => ({
  saleId: text(value?.saleId || value?.id),
  operationKey: text(value?.operationKey || value?.operation_key),
  orderNumber: text(value?.orderNumber || value?.order_number),
  businessDate: text(value?.businessDate || value?.business_date),
  operationalDayId: text(value?.operationalDayId || value?.operational_day_id),
  total: number(value?.total ?? value?.subtotal ?? value?.net),
})

export const diagnosticMatchesSale = (diagnostic, sale) => {
  const expected = diagnosticIdentity(diagnostic)
  const actual = diagnosticIdentity(sale)
  return Boolean(expected.saleId && actual.saleId && expected.saleId === actual.saleId
    && (!expected.operationKey || expected.operationKey === actual.operationKey)
    && expected.orderNumber === actual.orderNumber
    && expected.businessDate === actual.businessDate
    && (!expected.operationalDayId || expected.operationalDayId === actual.operationalDayId)
    && expected.total === actual.total)
}

export const classifyPendingDiagnostic = (diagnostic, centralSales = []) => {
  const expected = diagnosticIdentity(diagnostic)
  const central = Array.isArray(centralSales) ? centralSales : []
  const identityMatches = central.filter(sale => {
    const actual = diagnosticIdentity(sale)
    return (expected.saleId && actual.saleId === expected.saleId)
      || (expected.operationKey && actual.operationKey === expected.operationKey)
      || (expected.orderNumber && actual.orderNumber === expected.orderNumber && actual.businessDate === expected.businessDate)
  })
  const exactMatches = identityMatches.filter(sale => diagnosticMatchesSale(diagnostic, sale))
  const status = identityMatches.length > 1 || exactMatches.length > 1
    ? 'DUPLICATE'
    : exactMatches.length === 1 && identityMatches.length === 1
      ? 'EXISTS_ONCE'
      : 'MISSING'
  return {
    ...expected,
    status,
    exactMatchCount: exactMatches.length,
    identityMatchCount: identityMatches.length,
    firebaseSale: status === 'EXISTS_ONCE' ? exactMatches[0] : null,
    actionSuggestion: status === 'EXISTS_ONCE'
      ? 'تم العثور على سجل واحد؛ يمكن اعتماد التشخيص كمحلول.'
      : status === 'DUPLICATE'
        ? 'تعارض/تكرار مركزي؛ لا تعِد الرفع ولا تنشئ بيعًا.'
        : 'السجل غير موجود؛ يلزم انتظار إعادة المحاولة أو حمولة محلية صالحة.'
  }
}

export const buildPendingSaleDiagnostic = (sale, { error = null, attempts = 0, createdAt = Date.now(), deviceId = '', kioskId = '' } = {}) => {
  const identity = diagnosticIdentity(sale)
  const items = saleItems(sale)
  const lastError = text(error?.code ? `${error.code}: ${error?.message || ''}` : error?.message || error).slice(0, 240)
  return {
    saleId: identity.saleId,
    operationKey: identity.operationKey,
    orderNumber: sale?.orderNumber ?? null,
    businessDate: identity.businessDate,
    operationalDayId: identity.operationalDayId,
    total: identity.total,
    itemCount: items.length,
    paymentMethod: text(sale?.paymentMethod || sale?.payment?.method || sale?.paymentType),
    cashier: text(sale?.cashierNameSnapshot || sale?.seller || sale?.cashierName),
    cashierId: text(sale?.cashierId || sale?.shiftId),
    deviceId: text(deviceId),
    kioskId: text(kioskId),
    createdAt: Number(sale?.createdAt) || createdAt,
    updatedAt: Date.now(),
    lastError,
    attempts: Math.max(0, Number(attempts) || 0),
    status: PENDING_DIAGNOSTIC_STATUS,
    centralSalePathKnown: false,
  }
}
