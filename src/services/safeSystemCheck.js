import { getKioskDeviceRecord } from './kioskAuth.js'
import { kioskAuthStatus, loadCentralProducts, readCentralExpensesForReports, readCentralOperationalDay, readCentralSalesForReports, readLocalOperationalDay } from './posCentralSync.js'
import { readRawSaleQueue, readSalesQuarantine } from './salesSyncQueue.js'
import { BUILD_SHA, VERSION_MANIFEST_PATH, validateDeployMeta } from './versionUpdate.js'

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
    return { name, status: result?.status || 'pass', message: safeText(result?.message, 'تم الفحص'), details: result?.details || null, repaired: result?.repaired === true }
  } catch (error) {
    return { name, status: 'fail', message: safeErrorMessage(error), details: { error: safeErrorMessage(error) }, repaired: false }
  }
}

export const runIndependentChecks = async checks => Promise.all(checks.map(([name, check]) => runSafeCheck(name, check)))

const readLocal = key => {
  try { return safeJsonParse(window.localStorage?.getItem(key), null) } catch { return null }
}

const isValidProduct = product => Boolean(product && safeText(product.id) && safeText(product.name) && Number.isFinite(Number(product.price)) && Number(product.price) >= 0)
const itemIsValid = item => Boolean(item && safeText(item.productId || item.id || item.name) && Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0 && Number.isFinite(Number(item.price)) && Array.isArray(item.options || []))

const queueSummary = () => {
  const raw = readRawSaleQueue()
  const quarantine = readSalesQuarantine()
  const rows = Array.isArray(raw) ? raw : []
  return {
    saleWriteCount: rows.filter(row => row?.kind !== 'void_update').length,
    voidUpdateCount: rows.filter(row => row?.kind === 'void_update').length,
    failedCount: rows.filter(row => row?.status === 'failed' || row?.lastError).length,
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

export const runSafeSystemCheck = async ({ session, operationalDay, activeOrder, orders, active, centralProducts, centralSales, pendingPayment, modal, saleInFlight, onRepairOrder, onRepairDay, onRepairPayment }) => {
  const results = await runIndependentChecks([
    ['bundle', checkBundle],
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
    ['cart', async () => {
      const raw = orders?.[active] || activeOrder
      const items = raw?.items
      const malformed = !Array.isArray(items) || items.filter(item => !itemIsValid(item)).length
      if (malformed && onRepairOrder) onRepairOrder()
      const total = Array.isArray(items) ? items.reduce((sum, item) => sum + safeNumber(item?.price) * safeNumber(item?.quantity), 0) : 0
      return { status: malformed ? 'warn' : 'pass', message: malformed ? 'تمت معالجة بنية السلة المحلية' : 'بنية السلة سليمة', repaired: Boolean(malformed), details: { itemCount: Array.isArray(items) ? items.length : 0, total: safeFormatMoney(total), malformed: Number(malformed) || 0 } }
    }],
    ['queues', async () => {
      const summary = queueSummary()
      return { status: summary.malformedCount ? 'warn' : 'pass', message: summary.malformedCount ? 'يوجد صف غير صالح؛ لم يتم حذفه' : 'تمت قراءة الطوابير دون تغيير', details: summary }
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
  const summary = { ok: fail.length === 0, status: fail.length ? 'fail' : warnings.length ? 'warn' : 'pass', timestamp: new Date().toISOString(), checks: results, warnings: warnings.map(result => `${result.name}: ${result.message}`), errors: fail.map(result => `${result.name}: ${result.message}`), safety: { firebaseWrites: 0, salesCreated: 0, queueDeletes: 0, localStorageWiped: false } }
  console.info('[POS101_SAFE_CHECK]', safeObjectSummary(summary))
  return summary
}
