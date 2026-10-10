import { normalizeCartItems, normalizeOrder, safeNumber, safeText } from './cartItem.js'
import { allocateCentralOrderNumber, readCentralOperationalDay, readCentralSalesForSaleEngine, saveCentralSaleImmediately } from './posCentralSync.js'
import { financialFingerprint, markSaleSynced, quarantineStaleSaleQueueEntries, salePayloadMatches } from './salesSyncQueue.js'
import { cleanupOversizedLocalCaches } from './localSalesCache.js'
import { classifySaleSyncError, isRetryableSaleError } from './saleSyncError.js'

export const SALE_ENGINE_STATES = Object.freeze({
  IDLE: 'IDLE',
  BUILDING: 'BUILDING',
  WRITING_FIREBASE: 'WRITING_FIREBASE',
  READING_BACK: 'READING_BACK',
  CONFIRMED: 'CONFIRMED',
  FAILED_RETRYABLE: 'FAILED_RETRYABLE',
  FAILED_FINAL: 'FAILED_FINAL',
})

export const CURRENT_SALE_RETRY_KEY = 'pos101.currentSaleRetry'
const storageOf = storage => storage || (typeof localStorage !== 'undefined' ? localStorage : null)
const text = (value, fallback = '') => safeText(value, fallback)
const finite = value => Number.isFinite(Number(value))
const same = (left, right) => String(left ?? '') === String(right ?? '')
const idOf = sale => text(sale?.saleId || sale?.id)
const operationOf = sale => text(sale?.operationKey || sale?.operation_key)
const pathFor = saleId => `pos101_sales/${saleId}`

const makeId = prefix => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const safeChoice = (value, fallback = '') => {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return text(value.label || value.name || value.value || value.id, fallback)
  return text(value, fallback)
}

const normalizeChoice = (value, prefix) => {
  if (value === null || value === undefined || value === '') return null
  const label = safeChoice(value)
  if (!label) return null
  const raw = value && typeof value === 'object' ? value : {}
  const price = safeNumber(raw.price ?? raw.priceDelta ?? raw.extraPrice ?? raw.delta, 0)
  return { id: text(raw.id || raw.key || `${prefix}-${label}`), label, name: label, price, priceDelta: price }
}

const normalizeSaleItems = rawItems => {
  if (!Array.isArray(rawItems) || !rawItems.length) throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
    const rawPrice = raw.unitPrice ?? raw.price ?? raw.unit_price
    const rawQuantity = raw.quantity ?? raw.qty ?? raw.count
    if (rawPrice !== undefined && (!finite(rawPrice) || Number(rawPrice) < 0)) throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
    if (rawQuantity !== undefined && (!finite(rawQuantity) || Number(rawQuantity) <= 0)) throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
    for (const list of [raw.options, raw.additions, raw.addOns, raw.addons, raw.extras, raw.selectedOptions, raw.selected_options]) {
      if (!Array.isArray(list)) continue
      for (const option of list) {
        const optionPrice = option && typeof option === 'object' ? (option.price ?? option.priceDelta ?? option.extraPrice ?? option.delta) : undefined
        if (optionPrice !== undefined && !finite(optionPrice)) throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
      }
    }
  }
  const normalized = normalizeCartItems(rawItems)
  if (!normalized.length) throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
  return normalized.map((item, index) => {
    const name = text(item?.displayName || item?.name || item?.name_ar)
    const quantity = Number(item?.quantity)
    const unitPrice = Number(item?.unitPrice ?? item?.price)
    if (!name || name === 'منتج غير مكتمل البيانات' || !finite(quantity) || quantity <= 0 || !finite(unitPrice) || unitPrice < 0) {
      throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
    }
    const clean = {
      id: text(item?.id || item?.productId, `item-${index + 1}`),
      cartItemId: text(item?.cartItemId || item?.lineId, `cart-item-${index + 1}`),
      lineId: text(item?.lineId || item?.cartItemId, `cart-item-${index + 1}`),
      productId: text(item?.productId || item?.id, `product-${index + 1}`),
      name,
      name_ar: name,
      displayName: name,
      english: text(item?.english),
      productType: text(item?.productType),
      parentProductId: text(item?.parentProductId),
      childProductId: text(item?.childProductId),
      variantId: text(item?.variantId),
      quantity,
      unitPrice,
      price: unitPrice,
      basePrice: safeNumber(item?.basePrice, unitPrice),
      total: unitPrice * quantity,
      lineTotal: unitPrice * quantity,
      size: normalizeChoice(item?.size, 'size'),
      options: Array.isArray(item?.options) ? item.options.map((entry, optionIndex) => normalizeChoice(entry, `option-${optionIndex + 1}`)).filter(Boolean) : [],
      additions: Array.isArray(item?.additions) ? item.additions.map((entry, optionIndex) => normalizeChoice(entry, `addition-${optionIndex + 1}`)).filter(Boolean) : [],
      selectedOptions: Array.isArray(item?.selectedOptions) ? item.selectedOptions.map((entry, optionIndex) => normalizeChoice(entry, `selected-${optionIndex + 1}`)).filter(Boolean) : [],
      notes: text(item?.notes || item?.note),
      note: text(item?.note || item?.notes),
    }
    if (!Object.values(clean).every(value => value !== undefined)) throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
    return clean
  })
}

const cleanPayment = payment => {
  const method = text(payment?.method || payment?.paymentMethod)
  if (!method) throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
  const next = { method }
  for (const key of ['received', 'change', 'cashAmount', 'electronicAmount']) {
    if (payment?.[key] !== undefined) {
      if (!finite(payment[key])) throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
      next[key] = Number(payment[key])
    }
  }
  return next
}

export const normalizeSaleAttempt = ({ activeOrder, payment, sellerName, session, operationalDay, subtotal, discount, total } = {}) => {
  const order = normalizeOrder(activeOrder || {})
  const items = normalizeSaleItems(order.items)
  const computedSubtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)
  const requestedSubtotal = subtotal === undefined ? computedSubtotal : Number(subtotal)
  const requestedDiscount = discount === undefined ? 0 : Number(discount)
  const requestedTotal = total === undefined ? Math.max(0, computedSubtotal - requestedDiscount) : Number(total)
  if (![requestedSubtotal, requestedDiscount, requestedTotal].every(finite) || requestedSubtotal < 0 || requestedDiscount < 0 || requestedTotal < 0
    || Math.abs(requestedSubtotal - computedSubtotal) > 0.001 || Math.abs(requestedTotal - Math.max(0, requestedSubtotal - requestedDiscount)) > 0.001) {
    throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
  }
  const dayId = text(operationalDay?.id || operationalDay?.operationalDayId)
  const businessDate = text(operationalDay?.businessDate)
  if (operationalDay && (!dayId || !businessDate || operationalDay?.status !== 'open')) throw Object.assign(new Error('اليوم التشغيلي غير جاهز للبيع.'), { code: 'ORDER_NUMBER_FAILED' })
  const seller = text(sellerName || session?.name || session?.shiftName)
  if (!seller) throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
  const paymentValue = cleanPayment(payment)
  const discountValue = requestedDiscount
  const cleanDiscount = order.discount && typeof order.discount === 'object'
    ? { kind: text(order.discount.kind), input: safeNumber(order.discount.input, 0), value: discountValue }
    : null
  const cleanOrder = {
    id: text(order.id),
    name: text(order.name),
    table: safeChoice(order.table),
    orderType: safeChoice(order.orderType),
    discount: cleanDiscount,
    subtotal: requestedSubtotal,
    total: requestedTotal,
    items,
  }
  return {
    items,
    subtotal: requestedSubtotal,
    discount: discountValue,
    total: requestedTotal,
    payment: paymentValue,
    seller,
    session: { shiftId: text(session?.shiftId), shiftType: text(session?.shiftType), shiftLabel: text(session?.shiftLabel), name: text(session?.name) },
    operationalDay: { id: dayId, businessDate },
    order: cleanOrder,
  }
}

const cartFingerprint = prepared => JSON.stringify({
  items: prepared.items.map(item => ({ id: item.id, lineId: item.lineId, quantity: item.quantity, unitPrice: item.unitPrice, size: item.size, options: item.options, additions: item.additions })),
  subtotal: prepared.subtotal,
  discount: prepared.discount,
  total: prepared.total,
})

const buildSale = (prepared, { saleId, operationKey, orderNumber }) => ({
  saleId,
  id: saleId,
  operationKey,
  orderNumber,
  status: 'completed',
  cashierId: prepared.session.shiftId,
  shiftId: prepared.session.shiftId,
  shiftType: prepared.session.shiftType || prepared.session.shiftId,
  shiftLabel: prepared.session.shiftLabel,
  cashierNameSnapshot: prepared.seller,
  shift: prepared.session.name,
  seller: prepared.seller,
  createdAt: Date.now(),
  businessDate: prepared.operationalDay.businessDate,
  operationalDayId: prepared.operationalDay.id,
  subtotal: prepared.subtotal,
  discount: prepared.discount,
  discountDetails: prepared.order.discount,
  total: prepared.total,
  paymentMethod: prepared.payment.method,
  payment: prepared.payment,
  items: prepared.items,
  order: prepared.order,
})

const identityMatches = (sale, remote) => {
  const idMatch = idOf(sale) && idOf(sale) === idOf(remote)
  const operationMatch = operationOf(sale) && operationOf(sale) === operationOf(remote)
  return Boolean(idMatch || operationMatch)
}

const exactMatch = (sale, remote) => identityMatches(sale, remote)
  && String(remote?.status || '').toLowerCase() === 'completed'
  && salePayloadMatches(sale, remote)

const readRetry = storage => {
  try {
    const raw = storage?.getItem?.(CURRENT_SALE_RETRY_KEY)
    const value = raw ? JSON.parse(raw) : null
    return value?.sale && value?.cartFingerprint ? value : null
  } catch { return null }
}

const writeRetry = (storage, value) => {
  try {
    storage?.setItem?.(CURRENT_SALE_RETRY_KEY, JSON.stringify(value))
    return { ok: true }
  } catch {
    try { cleanupOversizedLocalCaches({ storage, centralReadable: false }) } catch { /* local retry remains in memory */ }
    try {
      storage?.setItem?.(CURRENT_SALE_RETRY_KEY, JSON.stringify(value))
      return { ok: true, cleaned: true }
    } catch { return { ok: false, cleaned: true } }
  }
}

const clearRetry = storage => {
  try { storage?.removeItem?.(CURRENT_SALE_RETRY_KEY) } catch { /* best effort */ }
}

const resultBase = ({ state, sale = null, errorClass = '', errorMessageAr = '', diagnostics = {}, duplicateDetected = false } = {}) => ({
  ok: state === SALE_ENGINE_STATES.CONFIRMED,
  state,
  saleId: idOf(sale),
  operationKey: operationOf(sale),
  orderNumber: sale?.orderNumber ?? null,
  firebasePath: sale ? pathFor(idOf(sale)) : '',
  errorClass,
  errorMessageAr,
  shouldClearCart: state === SALE_ENGINE_STATES.CONFIRMED,
  shouldRetrySamePayload: Boolean(sale && state === SALE_ENGINE_STATES.FAILED_RETRYABLE),
  centralVerified: state === SALE_ENGINE_STATES.CONFIRMED,
  duplicateDetected,
  diagnostics,
  sale,
})

export const createSaleEngine = (overrides = {}) => {
  const storage = storageOf(overrides.storage)
  const dependencies = {
    readOperationalDay: readCentralOperationalDay,
    allocateOrderNumber: allocateCentralOrderNumber,
    readCentralSales: readCentralSalesForSaleEngine,
    writeCentralSale: saveCentralSaleImmediately,
    markLocalSynced: markSaleSynced,
    quarantineStaleQueue: quarantineStaleSaleQueueEntries,
    classifyError: classifySaleSyncError,
    ...overrides,
  }
  let state = SALE_ENGINE_STATES.IDLE
  let inFlight = null
  let retryPayload = readRetry(storage)

  const setState = next => { state = next; if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sale-engine-state', { detail: { state: next } })) }
  const currentState = () => ({ state, inFlight: Boolean(inFlight), retryAvailable: Boolean(retryPayload) })

  const fail = ({ sale, error, diagnostics = {}, final = false, errorClass = '' } = {}) => {
    const classified = errorClass ? { errorClass, messageAr: error?.message || 'فشل إرسال الطلب.' } : dependencies.classifyError(error)
    const retryable = !final && isRetryableSaleError(classified.errorClass)
    setState(retryable ? SALE_ENGINE_STATES.FAILED_RETRYABLE : SALE_ENGINE_STATES.FAILED_FINAL)
    return resultBase({ state: retryable ? SALE_ENGINE_STATES.FAILED_RETRYABLE : SALE_ENGINE_STATES.FAILED_FINAL, sale, errorClass: classified.errorClass, errorMessageAr: classified.errorMessageAr || classified.messageAr, diagnostics: { ...diagnostics, code: error?.code || '', message: error?.message || String(error || '') } })
  }

  const confirm = async (sale, diagnostics = {}) => {
    setState(SALE_ENGINE_STATES.READING_BACK)
    let local = null
    try { local = await Promise.resolve(dependencies.markLocalSynced(sale)) } catch (error) {
      local = { centralVerified: false, localCacheOk: false, cacheWrite: { ok: false, error: error?.code || error?.message || String(error) } }
    }
    const cacheWarning = local?.cacheWrite?.ok === false || local?.localCacheOk === false ? 'تم تثبيت الطلب مركزيًا، لكن تعذر تحديث الكاش المحلي.' : ''
    retryPayload = null
    clearRetry(storage)
    setState(SALE_ENGINE_STATES.CONFIRMED)
    return resultBase({ state: SALE_ENGINE_STATES.CONFIRMED, sale, diagnostics: { ...diagnostics, readbackVerified: true, localCacheWarning: cacheWarning, cacheWrite: local?.cacheWrite || null } })
  }

  const execute = async input => {
    setState(SALE_ENGINE_STATES.BUILDING)
    let prepared
    try {
      // Normalize the cart before reading Firebase. An invalid cart must be a
      // local failure with zero central writes, even when the day/auth read is
      // temporarily unavailable.
      normalizeSaleAttempt(input)
      const operationalDay = await dependencies.readOperationalDay()
      prepared = normalizeSaleAttempt({ ...input, operationalDay })
      try { dependencies.quarantineStaleQueue({ operationalDay, centralSales: [] }) } catch (error) { console.warn('POS101_STALE_QUEUE_QUARANTINE_SKIPPED', error?.message || String(error)) }
    } catch (error) {
      return fail({ error, final: error?.code === 'PAYLOAD_INVALID' })
    }

    const fingerprint = cartFingerprint(prepared)
    const stored = retryPayload && retryPayload.cartFingerprint === fingerprint ? retryPayload : null
    let sale = stored?.sale || null
    try {
      if (!sale) {
        const allocation = await dependencies.allocateOrderNumber({ operationalDayId: prepared.operationalDay.id, businessDate: prepared.operationalDay.businessDate })
        if (!allocation?.reserved && allocation?.reserved !== undefined) throw Object.assign(new Error('تعذر تخصيص رقم الطلب.'), { code: 'ORDER_NUMBER_FAILED' })
        const saleId = makeId('sale')
        sale = buildSale(prepared, { saleId, operationKey: `pos101:${saleId}`, orderNumber: allocation?.orderNumber })
      } else if (!same(sale.businessDate, prepared.operationalDay.businessDate) || !same(sale.operationalDayId, prepared.operationalDay.id)) {
        throw Object.assign(new Error('لا يمكن إعادة إرسال طلب مرتبط بيوم تشغيلي قديم.'), { code: 'ORDER_NUMBER_FAILED' })
      }
      if (!sale?.orderNumber || !idOf(sale) || !operationOf(sale)) throw Object.assign(new Error('تعذر تجهيز الطلب، تحقق من عناصر السلة.'), { code: 'PAYLOAD_INVALID' })
    } catch (error) {
      return fail({ sale, error, final: error?.code === 'PAYLOAD_INVALID' })
    }

    const retryRecord = { version: 1, savedAt: Date.now(), cartFingerprint: fingerprint, sale, sellerName: prepared.seller }
    retryPayload = retryRecord
    const persistedRetry = writeRetry(storage, retryRecord)
    const diagnostics = { retryPayloadPersisted: persistedRetry.ok, retryPayloadInMemory: true, oldQueueIgnored: true }

    let centralSales
    try { centralSales = await dependencies.readCentralSales({ sale }) } catch (error) {
      return fail({ sale, error, diagnostics })
    }
    const matches = (Array.isArray(centralSales) ? centralSales : []).filter(remote => identityMatches(sale, remote))
    if (matches.length > 1) return fail({ sale, error: Object.assign(new Error('توجد نسخ متعددة من نفس هوية البيع.'), { code: 'TRUE_DUPLICATE' }), diagnostics, final: true, errorClass: 'TRUE_DUPLICATE' })
    if (matches.length === 1) {
      if (exactMatch(sale, matches[0])) return confirm(matches[0], { ...diagnostics, duplicateDetected: true, duplicateResolved: 'EXISTS_ONCE' })
      return fail({ sale, error: Object.assign(new Error('معرف البيع موجود ببيانات مختلفة.'), { code: 'SALE_ID_COLLISION' }), diagnostics, final: true, errorClass: 'SALE_ID_COLLISION' })
    }

    setState(SALE_ENGINE_STATES.WRITING_FIREBASE)
    try {
      const written = await dependencies.writeCentralSale(sale)
      if (!written?.readbackVerified || !written?.sale) throw Object.assign(new Error('تمت الكتابة لكن readback غير مؤكد.'), { code: 'SALE_READBACK_FAILED' })
      setState(SALE_ENGINE_STATES.READING_BACK)
      if (!exactMatch(sale, written.sale) || String(written.sale.status || '').toLowerCase() !== 'completed') throw Object.assign(new Error('تعذر تأكيد الطلب مركزيًا.'), { code: 'SALE_READBACK_FAILED' })
      return confirm(written.sale, { ...diagnostics, firebaseWrite: 'completed' })
    } catch (error) {
      // A lost response is never rewritten blindly. Read the canonical sales
      // snapshot once more; an exact single match is already a success.
      try {
        const afterFailure = await dependencies.readCentralSales({ sale, afterWriteFailure: true })
        const exact = (Array.isArray(afterFailure) ? afterFailure : []).filter(remote => exactMatch(sale, remote))
        const identity = (Array.isArray(afterFailure) ? afterFailure : []).filter(remote => identityMatches(sale, remote))
        if (exact.length === 1 && identity.length === 1) return confirm(exact[0], { ...diagnostics, writeFailureResolvedByReadback: true })
        if (identity.length > 0 && exact.length === 0) return fail({ sale, error: Object.assign(new Error('معرف البيع موجود ببيانات مختلفة.'), { code: 'SALE_ID_COLLISION' }), diagnostics, final: true, errorClass: 'SALE_ID_COLLISION' })
      } catch (readError) { diagnostics.readbackAfterWriteFailure = readError?.code || readError?.message || String(readError) }
      return fail({ sale, error, diagnostics })
    }
  }

  const sell = input => {
    if (inFlight) return inFlight
    inFlight = execute(input).catch(error => fail({ error })).finally(() => { inFlight = null })
    return inFlight
  }

  return {
    sell,
    retry: sell,
    getState: currentState,
    hasRetryPayload: () => Boolean(retryPayload),
    clearRetry: () => { retryPayload = null; clearRetry(storage) },
  }
}

export const saleEngine = createSaleEngine()

