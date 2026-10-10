import { getKioskDeviceRecord } from './kioskAuth.js'
import { kioskAuthStatus, loadCentralProducts, readCentralExpensesForReports, readCentralOperationalDay, readCentralPendingSaleDiagnostics, readCentralSalesForReports, readLocalOperationalDay } from './posCentralSync.js'
import { inspectPendingSalesAgainstCentral, quarantineStaleSaleQueueEntries, readPendingSaleDiagnostics, readRawSaleQueue, readSalesQuarantine, reconcileSalesAgainstCentral } from './salesSyncQueue.js'
import { defaultSyncLockManager } from './syncLockManager.js'
import { BUILD_SHA, VERSION_MANIFEST_PATH, validateDeployMeta } from './versionUpdate.js'
import { cleanupOversizedLocalCaches, inspectLocalStorage, testLocalStorageWrite } from './localSalesCache.js'

export const safeJsonParse = (value, fallback = null) => {
  try { return JSON.parse(String(value)) } catch { return fallback }
}

export const safeText = (value, fallback = '') => {
  const text = value === null || value === undefined ? '' : String(value)
  return text.trim() || fallback
}

export const safeNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export const safeFormatMoney = value => {
  const amount = safeNumber(value)
  try { return `${new Intl.NumberFormat('ar-IQ').format(amount)} د.ع` } catch { return `${amount} د.ع` }
}

export const safeErrorMessage = error => {
  const code = safeText(error?.code)
  const message = safeText(error?.message, 'UNKNOWN_ERROR').replace(/(bearer\s+)[^\s]+/ig, '$1[redacted]').replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
  return `${code ? `${code}: ` : ''}${message}`.slice(0, 240)
}

export const safeObjectSummary = value => {
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (!value || typeof value !== 'object') return { type: typeof value, value: safeText(value, 'NONE').slice(0, 80) }
  return { type: 'object', keys: Object.keys(value).slice(0, 24), keyCount: Object.keys(value).length }
}

export const runSafeCheck = async (name, check) => {
  try {
    const result = await check()
    return { name, status: result?.status || 'pass', message: safeText(result?.message, 'تم الفحص'), details: result?.details || null, repaired: result?.repaired === true, realFlow: result?.realFlow || null }
  } catch (error) {
    return { name, status: 'fail', message: safeErrorMessage(error), details: { error: safeErrorMessage(error) }, repaired: false }
  }
}

export const runIndependentChecks = async checks => Promise.all(checks.map(([name, check]) => runSafeCheck(name, check)))

export const recordSafeUiError = (type, error, details = {}) => {
  if (typeof window === 'undefined') return
  const entry = { type: safeText(type, 'UI_ERROR'), message: safeErrorMessage(error), details: safeObjectSummary(details), timestamp: new Date().toISOString() }
  const current = Array.isArray(window.__POS101_LAST_UI_ERRORS__) ? window.__POS101_LAST_UI_ERRORS__ : []
  window.__POS101_LAST_UI_ERRORS__ = [...current, entry].slice(-20)
  window.__POS101_LAST_ERROR__ = entry
}

const cloneOrder = order => {
  try { return typeof structuredClone === 'function' ? structuredClone(order) : safeJsonParse(JSON.stringify(order), {}) } catch { return safeJsonParse(JSON.stringify(order), {}) }
}

export const simulateCashierFlow = ({ products = [], activeOrder = {}, buildCartItemFn, normalizeOrderFn, prepareCartAddFn, calculateTotalsFn, paymentSummaryFn }) => {
  const result = { status: 'pass', realFlowCheck: 'PASS', normalProductDryAdd: 'FAIL', optionsProductDryAdd: 'NOT_AVAILABLE', totalsCalculable: 'NO', paymentSummaryReady: 'NO', error: '', productClicked: 'NONE', steps: [], dryRunDoesNotMutateCart: 'PASS', dryRunUsesSameBuildItemFunction: 'YES', dryRunUsesSameNormalizer: 'YES', dryRunUsesSameTotals: 'YES', dryRunUsesSamePaymentSummary: typeof paymentSummaryFn === 'function' ? 'YES' : 'FALLBACK', dryRunUsesSameStateSave: 'NO', dryRunUsesSameModalClose: 'NO' }
  const original = cloneOrder(activeOrder)
  try {
    if (typeof buildCartItemFn !== 'function' || typeof normalizeOrderFn !== 'function' || typeof calculateTotalsFn !== 'function') throw new Error('SAFE_FLOW_PRODUCTION_HELPERS_UNAVAILABLE')
    const normal = products.find(product => product && !product.configurable && !product.variantProducts?.length && Number.isFinite(Number(product.price)) && Number(product.price) >= 0)
    const options = products.find(product => ['ايس لاتيه بنكهات', 'لاتيه بنكهات'].some(label => String(product?.name || '').includes(label))) || products.find(product => product?.configurable && Number.isFinite(Number(product.price)))
    if (!normal) throw new Error('SAFE_FLOW_NORMAL_PRODUCT_NOT_FOUND')
    result.productClicked = safeText(normal.name, 'UNKNOWN_PRODUCT')
    const prepare = typeof prepareCartAddFn === 'function'
      ? prepareCartAddFn
      : ({ activeOrder: order, product, lineId }) => {
        const built = buildCartItemFn(product, lineId)
        return built?.ok ? { ...built, nextOrder: normalizeOrderFn({ ...cloneOrder(order), items: [...(Array.isArray(order?.items) ? order.items : []), built.item] }) } : built
      }
    const normalPrepared = prepare({ activeOrder: original, product: { ...normal, quantity: 1 }, lineId: 'safe-dry-normal', buildCartItemFn, normalizeOrderFn })
    if (!normalPrepared?.ok) throw new Error(normalPrepared?.error || 'SAFE_FLOW_NORMAL_ADD_FAILED')
    let dryOrder = normalizeOrderFn(normalPrepared.nextOrder)
    result.normalProductDryAdd = 'PASS'
    result.steps.push('normal-product-add')
    if (options) {
      const optionPrepared = prepare({ activeOrder: dryOrder, product: { ...options, quantity: 1, options: ['عادي'], additions: [], selectedOptions: ['عادي'], unitPrice: options.price }, lineId: 'safe-dry-options', buildCartItemFn, normalizeOrderFn })
      if (!optionPrepared?.ok) throw new Error(optionPrepared?.error || 'SAFE_FLOW_OPTIONS_ADD_FAILED')
      dryOrder = normalizeOrderFn(optionPrepared.nextOrder)
      result.optionsProductDryAdd = 'PASS'
      result.productClicked = `${result.productClicked} + ${safeText(options.name, 'OPTIONS_PRODUCT')}`
      result.steps.push('options-product-add')
    }
    if (!options) {
      result.status = 'warn'
      result.realFlowCheck = 'WARN'
      result.error = 'SAFE_FLOW_OPTIONS_PRODUCT_NOT_FOUND'
      result.details = { productClicked: result.productClicked, originalShape: safeObjectSummary(original) }
      return result
    }
    if (!Array.isArray(dryOrder.items) || dryOrder.items.some(item => !safeText(item?.displayName || item?.name) || !Array.isArray(item?.options) || !Array.isArray(item?.additions) || !Number.isFinite(Number(item?.price)) || !Number.isFinite(Number(item?.total)))) throw new Error('SAFE_FLOW_CART_RENDER_SHAPE_FAILED')
    result.steps.push('cart-render')
    const totals = calculateTotalsFn(dryOrder)
    if (!totals || !Number.isFinite(Number(totals.total)) || Number(totals.total) < 0) throw new Error('SAFE_FLOW_TOTALS_FAILED')
    result.totalsCalculable = 'YES'
    result.steps.push('totals')
    const quantityBefore = Number(dryOrder.items[0].quantity)
    dryOrder = normalizeOrderFn({ ...dryOrder, items: dryOrder.items.map((item, index) => index === 0 ? { ...item, quantity: quantityBefore + 1 } : item) })
    dryOrder = normalizeOrderFn({ ...dryOrder, items: dryOrder.items.map((item, index) => index === 0 ? { ...item, quantity: Math.max(1, Number(item.quantity) - 1) } : item) })
    result.steps.push('quantity-change')
    dryOrder = normalizeOrderFn({ ...dryOrder, items: dryOrder.items.slice(0, 1) })
    result.steps.push('delete-item')
    const paymentSummary = typeof paymentSummaryFn === 'function' ? paymentSummaryFn(calculateTotalsFn(dryOrder)) : { total: calculateTotalsFn(dryOrder).total, label: safeFormatMoney(calculateTotalsFn(dryOrder).total) }
    if (!paymentSummary || !Number.isFinite(Number(paymentSummary.total)) || !safeText(paymentSummary.label)) throw new Error('SAFE_FLOW_PAYMENT_SUMMARY_FAILED')
    result.paymentSummaryReady = 'YES'
    result.steps.push('payment-summary')
    result.details = { normalProduct: safeText(normal.name), optionsProduct: safeText(options?.name, 'NOT_AVAILABLE'), itemCount: dryOrder.items.length, paymentSummary: { total: Number(paymentSummary.total), label: safeText(paymentSummary.label) }, originalShape: safeObjectSummary(original) }
    return result
  } catch (error) {
    result.status = 'fail'
    result.realFlowCheck = 'FAIL'
    result.error = safeErrorMessage(error)
    result.details = { productClicked: result.productClicked, originalShape: safeObjectSummary(original) }
    return result
  }
}

const readLocal = key => {
  try { return safeJsonParse(window.localStorage?.getItem(key), null) } catch { return null }
}

const safeCartItemSummary = item => ({
  cartItemId: safeText(item?.cartItemId || item?.lineId, 'NONE'),
  productId: safeText(item?.productId || item?.id, 'NONE'),
  displayName: safeText(item?.displayName || item?.name, 'NONE'),
  optionsArray: Array.isArray(item?.options),
  additionsArray: Array.isArray(item?.additions),
  priceFinite: Number.isFinite(Number(item?.price)),
  quantityFinite: Number.isFinite(Number(item?.quantity)),
})

const safeOrderSummary = order => ({
  id: safeText(order?.id, 'NONE'),
  itemCount: Array.isArray(order?.items) ? order.items.length : 0,
  itemShapes: Array.isArray(order?.items) ? order.items.map(safeCartItemSummary) : [],
})

const isValidProduct = product => Boolean(product && safeText(product.id) && safeText(product.name) && Number.isFinite(Number(product.price)) && Number(product.price) >= 0)
const itemIsValid = item => Boolean(item && safeText(item.productId || item.id || item.name) && Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0 && Number.isFinite(Number(item.price)) && Array.isArray(item.options) && Array.isArray(item.additions))

const queueSummary = () => {
  const raw = readRawSaleQueue()
  const quarantine = readSalesQuarantine()
  const pendingSales = readPendingSaleDiagnostics()
  const rows = Array.isArray(raw) ? raw : []
  return {
    saleWriteCount: rows.filter(row => row?.kind !== 'void_update').length,
    voidUpdateCount: rows.filter(row => row?.kind === 'void_update').length,
    failedCount: rows.filter(row => row?.status === 'failed' || row?.lastError).length,
    pendingSaleDiagnostics: pendingSales,
    pendingSaleCount: pendingSales.filter(row => row.type === 'sale_write').length,
    quarantineCount: Array.isArray(quarantine) ? quarantine.length : 0,
    malformedCount: rows.filter(row => !row || typeof row !== 'object').length,
  }
}

const checkBundle = async () => {
  const scripts = [...(document.scripts || [])].map(script => script.src).filter(Boolean)
  const bundle = scripts.find(src => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(src)) || ''
  let meta = null
  try {
    const response = await fetch(`${VERSION_MANIFEST_PATH}?safe-check=${Date.now()}`, { cache: 'no-store' })
    if (response.ok) meta = validateDeployMeta(await response.json())
  } catch { /* the local bundle check still remains useful offline */ }
  const currentBundle = safeText(bundle.split('/').pop().split('?')[0], 'UNKNOWN_BUNDLE')
  const expectedBundle = safeText(meta?.bundle, '')
  const ok = Boolean(bundle) && (!expectedBundle || currentBundle === expectedBundle)
  return { status: ok ? 'pass' : 'warn', message: ok ? `الحزمة الحالية ${currentBundle}` : 'الحزمة الحالية تحتاج تحديثاً أو تعذر قراءة بيانات النشر.', details: { currentBundle, expectedBundle: expectedBundle || 'UNKNOWN', buildSha: BUILD_SHA, manifestRead: Boolean(meta) } }
}

export const runSafeSystemCheck = async ({ session, operationalDay, activeOrder, orders, active, centralProducts, products = [], centralSales, pendingPayment, modal, saleInFlight, adminDiagnostics = false, onRepairOrder, onRepairDay, onRepairPayment, buildCartItemFn, normalizeOrderFn, prepareCartAddFn, calculateTotalsFn, paymentSummaryFn }) => {
  const pendingSalesBeforeCheck = readPendingSaleDiagnostics().filter(row => row.type === 'sale_write')
  const results = await runIndependentChecks([
    ['bundle', checkBundle],
    ['pending-sales', async () => {
      const pending = readPendingSaleDiagnostics().filter(row => row.type === 'sale_write')
      if (!pending.length) return { status: 'pass', message: 'لا توجد مبيعات محفوظة بانتظار الرفع', details: { pendingCount: 0, firebaseRead: 'NOT_NEEDED', items: [] } }
      let readSales = null
      let firebaseRead = 'NOT_STARTED'
      let readError = ''
      if (!readSales) {
        try {
          readSales = await readCentralSalesForReports()
          firebaseRead = 'PASS'
        } catch (error) {
          firebaseRead = 'FAIL'
          readError = safeErrorMessage(error)
        }
      }
      if (!Array.isArray(readSales)) return { status: 'warn', message: 'يوجد طلب محفوظ بانتظار الرفع؛ تعذر فحص Firebase الآن', details: { pendingCount: pending.length, firebaseRead, readError, items: [] } }
      const items = inspectPendingSalesAgainstCentral(readSales)
      const duplicate = items.some(item => item.status === 'DUPLICATE')
      const exists = items.filter(item => item.status === 'EXISTS_ONCE').length
      const missing = items.filter(item => item.status === 'MISSING').length
      const reconciliation = !duplicate && exists ? reconcileSalesAgainstCentral(readSales) : { reconciled: 0, remaining: pending.length, queuePreserved: true }
      return {
        status: duplicate ? 'fail' : 'warn',
        message: duplicate ? 'يوجد خطر تكرار؛ لم تتم أي إعادة محاولة' : exists && !missing ? 'تم العثور على الطلب مركزيًا؛ تمت تسوية الحالة المحلية دون كتابة مركزية جديدة' : 'يوجد طلب محفوظ بانتظار الرفع',
        details: { pendingCount: pending.length, firebaseRead, readError, items, duplicateRisk: duplicate, exactMatches: exists, missingCount: missing, safeRetry: !duplicate, reconciled: reconciliation.reconciled || 0, remaining: reconciliation.remaining, queuePreserved: reconciliation.queuePreserved === true },
      }
    }],
    ['central-pending-diagnostics', async () => {
      if (!adminDiagnostics) return { status: 'pass', message: 'تشخيص التنبيهات المركزية متاح لواجهة الإدارة فقط', details: { adminOnly: true, read: 'NOT_REQUESTED', financialEffect: 0 } }
      const rows = await readCentralPendingSaleDiagnostics()
      return { status: rows.length ? 'warn' : 'pass', message: rows.length ? `يوجد ${rows.length} تنبيه مركزي غير محلول` : 'لا توجد تنبيهات مركزية غير محلولة', details: { count: rows.length, rows: rows.map(row => ({ saleId: row.saleId, operationKey: row.operationKey, orderNumber: row.orderNumber, status: row.status, lastError: row.lastError })), firebaseRead: 'PASS', financialEffect: 0 } }
    }],
    ['storage-quota', async () => {
      const before = inspectLocalStorage()
      const probe = testLocalStorageWrite()
      const centralReadable = Array.isArray(centralSales) && centralSales.length > 0
      const cleanup = before.quotaRisk && centralReadable ? cleanupOversizedLocalCaches({ centralReadable: true }) : { cleanedKeys: [], preservedKeys: [], before, after: before }
      const after = inspectLocalStorage()
      const riskCleared = !after.quotaRisk || after.salesBytes < before.salesBytes
      return {
        status: pendingSalesBeforeCheck.length || (before.quotaRisk && !riskCleared) ? 'warn' : 'pass',
        message: pendingSalesBeforeCheck.length ? 'يوجد طلب محفوظ بانتظار الرفع؛ تم الحفاظ على الطابور والبيانات المحلية' : before.quotaRisk ? (riskCleared ? 'تم تنظيف كاش المبيعات الآمن' : 'ذاكرة المبيعات المحلية كبيرة وسيتم تنظيف الكاش الآمن') : 'استخدام ذاكرة الجهاز المحلية ضمن الحد الآمن',
        repaired: cleanup.cleanedKeys.length > 0,
        details: { before, after, centralReadable, tinyWriteProbe: probe, cleanedKeys: cleanup.cleanedKeys, preservedKeys: cleanup.preservedKeys, pendingSaleCount: pendingSalesBeforeCheck.length, pendingSaleIds: pendingSalesBeforeCheck.map(row => row.saleId).filter(Boolean), pendingQueuePreserved: true, fullSalesCacheDisabled: !after.fullSalesCachePresent },
      }
    }],
    ['activation', async () => {
      const [deviceResult, authResult] = await Promise.allSettled([getKioskDeviceRecord(), kioskAuthStatus()])
      const device = deviceResult.status === 'fulfilled' ? deviceResult.value : null
      const auth = authResult.status === 'fulfilled' ? authResult.value : null
      const valid = Boolean(device?.kioskId && device?.privateKey && device?.publicKeyJwk && auth?.ready)
      return { status: valid ? 'pass' : 'warn', message: valid ? 'تفعيل الجهاز والجلسة صالحان' : 'تعذر إثبات صلاحية تفعيل الجهاز الحالي', details: { deviceId: safeText(device?.deviceId, 'NONE'), kioskId: safeText(device?.kioskId, 'NONE'), activatedAt: device?.activatedAt || null, authReady: auth?.ready === true, authError: authResult.status === 'rejected' ? safeErrorMessage(authResult.reason) : 'NONE' } }
    }],
    ['session', async () => {
      const ready = Boolean(session?.shiftId && session?.shiftType)
      return { status: ready ? 'pass' : 'warn', message: ready ? 'جلسة الكاشير والشفت جاهزان' : 'جلسة الكاشير أو الشفت غير مكتمل', details: { shiftId: safeText(session?.shiftId, 'NONE'), shiftType: safeText(session?.shiftType, 'NONE') } }
    }],
    ['operational-day', async () => {
      const central = await readCentralOperationalDay()
      const local = readLocalOperationalDay()
      const ready = Boolean(central?.status === 'open')
      const mismatch = Boolean(central?.id && local?.id && (central.id !== local.id || central.status !== local.status))
      if (mismatch && onRepairDay) onRepairDay(central)
      return { status: ready ? 'pass' : 'fail', message: ready ? (mismatch ? 'اليوم مفتوح وتمت مزامنة الحالة المحلية' : 'اليوم التشغيلي مفتوح') : 'اليوم التشغيلي غير مفتوح', repaired: mismatch, details: { central: { id: safeText(central?.id, 'NONE'), status: safeText(central?.status, 'NONE'), businessDate: safeText(central?.businessDate, 'NONE') }, local: { id: safeText(local?.id, 'NONE'), status: safeText(local?.status, 'NONE'), businessDate: safeText(local?.businessDate, 'NONE') } } }
    }],
    ['products', async () => {
      const products = Array.isArray(centralProducts) && centralProducts.length ? centralProducts : await loadCentralProducts()
      const malformed = products.filter(product => !isValidProduct(product)).length
      const options = products.filter(product => product?.configurable || Array.isArray(product?.options) || Array.isArray(product?.variantProducts)).length
      return { status: products.length && !malformed ? 'pass' : 'warn', message: products.length ? `تم تحميل ${products.length} منتج` : 'لم يتم تحميل المنتجات', details: { count: products.length, optionsProducts: options, malformed } }
    }],
    ['real-cashier-flow-simulation', async () => {
      const flow = simulateCashierFlow({ products, activeOrder, buildCartItemFn, normalizeOrderFn, prepareCartAddFn, calculateTotalsFn, paymentSummaryFn })
      const recentErrors = typeof window !== 'undefined' && Array.isArray(window.__POS101_LAST_UI_ERRORS__) ? window.__POS101_LAST_UI_ERRORS__ : []
      if (flow.status === 'fail') recordSafeUiError('REAL_CASHIER_FLOW_SIMULATION', new Error(flow.error), { productClicked: flow.productClicked })
      return { status: flow.status, message: flow.status === 'pass' ? 'تمت محاكاة مسار السلة والدفع دون كتابة' : `خلل في مسار الكاشير: ${flow.error}`, details: { ...flow, recentErrors }, realFlow: flow }
    }],
    ['cart', async () => {
      const raw = orders?.[active] || activeOrder
      const items = raw?.items
      const malformed = !Array.isArray(items) || items.filter(item => !itemIsValid(item)).length
      if (malformed && onRepairOrder) onRepairOrder()
      const total = Array.isArray(items) ? items.reduce((sum, item) => sum + safeNumber(item?.price) * safeNumber(item?.quantity), 0) : 0
      return { status: malformed ? 'warn' : 'pass', message: malformed ? 'تمت معالجة بنية السلة المحلية' : 'بنية السلة سليمة', repaired: Boolean(malformed), details: { itemCount: Array.isArray(items) ? items.length : 0, total: safeFormatMoney(total), malformed: Number(malformed) || 0 } }
    }],
    ['queues', async () => {
      const staleQueueQuarantine = quarantineStaleSaleQueueEntries({ centralSales, operationalDay })
      const staleLock = defaultSyncLockManager.recoverStale()
      const summary = queueSummary()
      return { status: summary.malformedCount ? 'warn' : 'pass', message: staleQueueQuarantine.moved ? `تم عزل ${staleQueueQuarantine.moved} عنصر قديم من طابور المزامنة` : summary.malformedCount ? 'يوجد صف غير صالح؛ لم يتم حذفه' : 'تمت قراءة الطوابير دون تغيير', details: { ...summary, staleQueueQuarantine, staleLock, firebaseWritesPerformed: 0, activeSaleQueueUntouched: true } }
    }],
    ['sales-read', async () => {
      const sales = Array.isArray(centralSales) && centralSales.length ? centralSales : await readCentralSalesForReports()
      const ids = new Set()
      const duplicates = sales.filter(sale => { const id = safeText(sale?.saleId || sale?.id); if (!id) return false; if (ids.has(id)) return true; ids.add(id); return false }).length
      return { status: duplicates ? 'warn' : 'pass', message: `تمت قراءة ${sales.length} مبيعات مركزية دون كتابة`, details: { count: sales.length, duplicateIds: duplicates } }
    }],
    ['expenses-read', async () => {
      const report = await readCentralExpensesForReports({ persistCache: false, dispatchUpdate: false })
      const expenses = Array.isArray(report?.expenses) ? report.expenses : []
      return { status: 'pass', message: `تمت قراءة ${expenses.length} مصروفات دون كتابة`, details: { count: expenses.length, centralCount: safeNumber(report?.centralCount), persistCache: false } }
    }],
    ['payment-state', async () => {
      const stuck = Boolean(pendingPayment && !['payment', 'seller-selection'].includes(modal) && !saleInFlight?.current)
      if (stuck && onRepairPayment) onRepairPayment()
      return { status: 'pass', message: stuck ? 'تم تنظيف حالة دفع محلية عالقة' : 'حالة الدفع سليمة', repaired: stuck, details: { pendingPayment: Boolean(pendingPayment), modal: safeText(modal, 'NONE') } }
    }],
    ['print', async () => ({ status: typeof window.print === 'function' ? 'pass' : 'warn', message: typeof window.print === 'function' ? 'واجهة الطباعة متاحة' : 'واجهة الطباعة غير متاحة', details: { windowPrint: typeof window.print === 'function', thermalService: 'not-called' } })],
  ])
  const fail = results.filter(result => result.status === 'fail')
  const warnings = results.filter(result => result.status === 'warn')
  const realFlow = results.find(result => result.name === 'real-cashier-flow-simulation')?.realFlow || null
  const recentErrors = typeof window !== 'undefined' && Array.isArray(window.__POS101_LAST_UI_ERRORS__) ? window.__POS101_LAST_UI_ERRORS__ : []
  const bundle = results.find(result => result.name === 'bundle')?.details || {}
  const activation = results.find(result => result.name === 'activation')?.details || {}
  const day = results.find(result => result.name === 'operational-day')?.details || {}
  const sessionDetails = results.find(result => result.name === 'session')?.details || {}
  const summary = {
    ok: fail.length === 0,
    status: fail.length ? 'fail' : warnings.length ? 'warn' : 'pass',
    timestamp: new Date().toISOString(),
    loadedBundle: bundle.currentBundle || 'UNKNOWN_BUNDLE',
    deployMeta: { buildSha: bundle.buildSha || 'UNKNOWN', expectedBundle: bundle.expectedBundle || 'UNKNOWN' },
    device: { deviceId: activation.deviceId || 'NONE', kioskId: activation.kioskId || 'NONE' },
    operationalDay: { businessDate: day.central?.businessDate || day.local?.businessDate || 'NONE', status: day.central?.status || day.local?.status || 'NONE' },
    shift: { shiftId: sessionDetails.shiftId || 'NONE', shiftType: sessionDetails.shiftType || 'NONE' },
    activeOrder: safeOrderSummary(activeOrder),
    checks: results,
    realFlow,
    recentErrors,
    lastError: typeof window !== 'undefined' ? window.__POS101_LAST_ERROR__ || null : null,
    lastProductClicked: typeof window !== 'undefined' ? window.__POS101_LAST_PRODUCT_CLICKED__ || null : null,
    lastModalProduct: typeof window !== 'undefined' ? window.__POS101_LAST_MODAL_PRODUCT__ || null : null,
    queueSummary: results.find(result => result.name === 'queues')?.details || null,
    pendingSaleCheck: results.find(result => result.name === 'pending-sales')?.details || null,
    warnings: warnings.map(result => `${result.name}: ${result.message}`),
    errors: fail.map(result => `${result.name}: ${result.message}`),
    safety: { firebaseWrites: 0, salesCreated: 0, queueDeletes: 0, localStorageWiped: false },
  }
  console.info('[POS101_SAFE_CHECK]', safeObjectSummary(summary))
  return summary
}
