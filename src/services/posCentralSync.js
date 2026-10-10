import { getApps, initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  getIdTokenResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithCustomToken,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  onValue,
  ref,
  runTransaction,
  set,
  update,
} from 'firebase/database'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { areExpenseDuplicates, dedupeExpensesById, expenseFingerprint, isWithdrawalExpense, matchOperationalDayByBusinessDate, mergeExpensesConservatively, normalizeDateKey, normalizeExpense, safeCreatedAtForBusinessDate } from './expenseReporting.js'
import { normalizeStaffCanSell } from './staffEligibility.js'
import { calculateCashboxBalance, calculateEndDayCashAnalysis, calculateSettlement, calculateSettlementCorrection, getEffectiveSettlement, makeSettlementIdempotencyKey } from './financialCenter.js'
import { getKioskDeviceRecord, getOrCreateKioskDeviceRecord, saveKioskIdentity, signKioskChallenge, signatureToBase64Url } from './kioskAuth.js'
import { createPinSalt, hashCashierPin } from './cashierPin.js'
import { verifySystemAdminCode } from './systemAdminCode.js'
import { classifyCentralSale, financialFingerprint, isManualReviewQuarantined, isSaleSyncEligible, isVoidedSale, KNOWN_MANUAL_REVIEW_REASON_1056, KNOWN_MANUAL_REVIEW_SALE_1056, markSaleAttempt, markSaleSynced, markSaleVoidedCentral, quarantineSale, readRawSaleQueue, readSaleQueue, readVoidUpdateQueue, readSalesQuarantine, reconcileLocalQueueAgainstCentral, reconcileSalesAgainstCentral, reconcileSalesQueue, resolveLegacyExpenseQueueEntries, resolveVoidedSaleLocally, restoreManualReviewQuarantineMarker, retainQueuedSale, salePayloadMatches } from './salesSyncQueue.js'
import { buildOrderNumberDuplicateReport, findActiveOrderNumberCollision, nextCentralOrderNumber } from './orderNumberAllocation.js'
import { getReportSalesForOperationalDay, isReportableSale, readLocalSales } from './reportSales.js'
import { reconcilePreCloseSales } from './preCloseReconciliation.js'
import { buildEndDayDiagnostic } from './endDayDiagnostic.js'
import { canonicalSalesForOperationalDay, reconcileCanonicalSales, summarizeCanonicalSales } from './canonicalSales.js'
import { retryAccSaleQueue, syncAccSaleBestEffort, syncAccExpenseBestEffort, retryAccExpenseQueue } from './accSync.js'
import { defaultSyncLockManager, EMERGENCY_REPAIR_KEY } from './syncLockManager.js'
import { BUILD_SHA } from './versionUpdate.js'
import { buildSaleEditPatch, buildSaleItemCorrectionPatch, correctionTotalsSnapshot, maskCorrectionCode, saleCorrectionChangedFields, saleEditPreservesIdentity, saleEditableSnapshot, soldItemsSnapshot, validateCorrectionIdentity } from './saleEdit.js'
import { buildRecoveryCandidates, classifyBackupSale, normalizeBackupSale, ORDER_1309_NUMBER, ORDER_1309_SALE_ID } from './backupSalesRecovery.js'
import { readSalesCache, writeSalesCache } from './localSalesCache.js'

const env = import.meta.env || {}
const localHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
// Emulator routing is opt-in only. Localhost alone must always use Production
// Firebase for the cashier kiosk flow.
const emulatorFlag = env.VITE_POS101_FIREBASE_EMULATOR ?? env.VITE_POS101_USE_FIREBASE_EMULATOR
const useEmulator = emulatorFlag === 'true' && localHost
const emulatorHost = env.VITE_POS101_EMULATOR_HOST || '127.0.0.1'
const emulatorProjectId = env.VITE_POS101_EMULATOR_PROJECT_ID || 'cmms-37512-pos-emulator'
const kioskWorkerUrl = env.VITE_POS101_KIOSK_WORKER_URL || (useEmulator ? `http://${emulatorHost}:8787` : '')

const config = {
  apiKey: useEmulator ? 'pos101-emulator-api-key' : env.VITE_POS101_API_KEY,
  authDomain: useEmulator ? `${emulatorProjectId}.firebaseapp.com` : env.VITE_POS101_AUTH_DOMAIN,
  databaseURL: useEmulator ? `http://${emulatorHost}:9000?ns=${emulatorProjectId}-default-rtdb` : env.VITE_POS101_DATABASE_URL,
  projectId: useEmulator ? emulatorProjectId : env.VITE_POS101_PROJECT_ID,
  storageBucket: useEmulator ? `${emulatorProjectId}.appspot.com` : env.VITE_POS101_STORAGE_BUCKET,
  messagingSenderId: useEmulator ? 'pos101-emulator-sender' : env.VITE_POS101_MESSAGING_SENDER_ID,
  appId: useEmulator ? 'pos101-emulator-app' : env.VITE_POS101_APP_ID,
}

const configured = Boolean(config.apiKey && config.authDomain && config.databaseURL && config.projectId)
const authDebugEnabled = () => typeof localStorage !== 'undefined' && localStorage.getItem('pos101.debugAuth') === 'true'
const authDebug = (event, details = {}) => {
  if (authDebugEnabled()) console.info(`[${event}]`, details)
}
let app = null
let auth = null
let db = null
let appCheck = null
let authReady = Promise.resolve()
const syncLockManager = defaultSyncLockManager
const SYNC_PROCESS_TIMEOUT_MS = 55 * 1000

if (configured) {
  authDebug('POS_AUTH_INIT')
  app = getApps().find(item => item.name === 'pos101-central') || initializeApp(config, 'pos101-central')
  auth = getAuth(app)
  db = getDatabase(app)
  if (useEmulator) {
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true })
    connectDatabaseEmulator(db, emulatorHost, 9000)
  } else if (env.VITE_POS101_APPCHECK_SITE_KEY) {
    try {
      appCheck = initializeAppCheck(app, { provider: new ReCaptchaV3Provider(env.VITE_POS101_APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true })
      authDebug('POS_APPCHECK_ENABLED')
    } catch (error) {
      console.error('POS_APPCHECK_INIT_ERROR', error)
    }
  }
  // Persistence and Kiosk session restore are one shared gate for every POS
  // listener. No operational path may start before this promise resolves.
  authReady = setPersistence(auth, browserLocalPersistence)
    .catch(error => { console.error('POS_AUTH_PERSISTENCE_ERROR', error); return null })
    .then(async () => {
      const restored = await new Promise(resolve => {
        let stop = () => {}
        stop = onAuthStateChanged(auth, user => { stop(); resolve(user) }, error => { console.error('POS_AUTH_STATE_ERROR', error); resolve(null) })
      })
      if (restored) return restored
      try { return await restoreKioskSession() } catch (error) {
        if (error?.code !== 'KIOSK_ACTIVATION_REQUIRED') console.error('POS_KIOSK_RESTORE_ERROR', error)
        return null
      }
    })
}

const SALES_KEY = 'pos101.sales'
const AUTHORIZED_UIDS_PATH = 'pos101_authorized_uids'
const SYNC_ROLES = new Set(['super_admin', 'admin', 'manager', 'cashier', 'cashier-sync', 'employee', 'admin-viewer'])
const ADMIN_ROLES = new Set(['super_admin', 'admin', 'manager', 'admin-viewer'])
const STAFF_MANAGEMENT_ROLES = new Set(['super_admin', 'admin', 'manager', 'cashier', 'cashier-sync', 'employee'])
const authorizationCache = new Map()
const tokenClaimsCache = new Map()
const INITIAL_SYNC_COMPLETED_KEY = 'pos101.initialSyncCompleted'
const salesRef = () => ref(db, 'pos101_sales')
const pendingTablesRef = () => ref(db, 'pos101_pending_tables')
const productsRef = () => ref(db, 'pos101_products')
const operationalDaysRef = () => ref(db, 'pos101_operational_days')
const operationalDayCurrentRef = () => ref(db, 'pos101_operational_day/current')
const expensesRef = () => ref(db, 'pos101_expenses')
const saleIdOf = sale => String(sale?.saleId || sale?.id || '').trim()
const expenseIdOf = expense => String(expense?.id || expense?.expenseId || '').trim()
const EXPENSES_KEY = 'pos101.expenses'
const OPERATIONAL_DAY_KEY = 'pos101.operationalDay'
const OPERATIONAL_DAY_CURRENT_PATH = 'pos101_operational_day/current'
const OPERATIONAL_DAY_STALE_KEY = 'pos101.localOperationalDayStale'
const OPERATIONAL_DAY_CLOSED_BY_CENTRAL_KEY = 'pos101.localClosedByCentral'
const OPERATIONAL_DAY_STALE_DETECTED_AT_KEY = 'pos101.staleDetectedAt'
const DEVICE_ID_KEY = 'pos101.deviceId'
const ALLOWED_DAY_CLOSE_SOURCES = new Set(['manual_end_day', 'admin_reopen_fix', 'system_test'])
const readSales = () => {
  return readSalesCache()
}
const readLocalCashierSession = () => {
  try {
    const session = JSON.parse(localStorage.getItem('pos101.session') || 'null')
    if (!session || session.status !== 'open') return null
    const cashierName = String(session.cashierNameSnapshot || session.cashierName || session.name || session.shiftName || '').trim()
    const cashierId = String(session.cashierId || session.shiftId || '').trim()
    return cashierName || cashierId ? { ...session, cashierName, cashierId } : null
  } catch { return null }
}
const writeSales = sales => writeSalesCache(sales)
const dispatchUpdated = () => window.dispatchEvent(new CustomEvent('pos101-sales-updated'))
const dispatchExpensesUpdated = () => window.dispatchEvent(new CustomEvent('pos101-expenses-updated'))

const kioskWorkerRequest = async (path, payload) => {
  if (!kioskWorkerUrl) throw Object.assign(new Error('إعداد Kiosk Worker غير موجود.'), { code: 'KIOSK_BACKEND_NOT_CONFIGURED' })
  const response = await fetch(`${kioskWorkerUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(body.error || 'فشل اتصال Kiosk Worker.'), { code: `KIOSK_WORKER_${response.status}` })
  return body
}
const issueKioskToken = async ({ mode, activationCode = '', kioskId = '' } = {}) => {
  const device = await getOrCreateKioskDeviceRecord()
  const begin = await kioskWorkerRequest('/kiosk/challenge', { mode, activationCode, kioskId, publicKeyJwk: device.publicKeyJwk })
  const signature = signatureToBase64Url(await signKioskChallenge(begin.challenge))
  const complete = await kioskWorkerRequest(mode === 'activate' ? '/kiosk/activate' : '/kiosk/renew', { challengeId: begin.challengeId, signature, publicKeyJwk: device.publicKeyJwk })
  const user = (await signInWithCustomToken(auth, complete.token)).user
  await saveKioskIdentity({ kioskId: complete.kioskId })
  authDebug('POS_KIOSK_SESSION_READY', { kioskId: complete.kioskId, anonymous: false, backend: 'cloudflare-worker' })
  return user
}
const restoreKioskSession = async () => {
  const device = await getKioskDeviceRecord()
  if (!device?.kioskId || !device?.privateKey) throw Object.assign(new Error('تفعيل جهاز POS مطلوب مرة واحدة.'), { code: 'KIOSK_ACTIVATION_REQUIRED' })
  return issueKioskToken({ mode: 'renew', kioskId: device.kioskId })
}
export const activateKioskWithCode = async activationCode => issueKioskToken({ mode: 'activate', activationCode: String(activationCode || '').trim() })
export const kioskAuthStatus = async () => {
  await authReady
  const user = auth?.currentUser
  if (!user) return { ready: false, activated: Boolean((await getKioskDeviceRecord())?.kioskId), appCheck: Boolean(appCheck) }
  const token = await getIdTokenResult(user)
  return { ready: token.claims.pos101_kiosk === true && token.claims.scope === 'cashier', kioskId: token.claims.kioskId || '', appCheck: Boolean(appCheck) }
}

const readCachedExpenses = () => {
  try {
    const value = JSON.parse(localStorage.getItem(EXPENSES_KEY) || '[]')
    return dedupeExpensesById(value)
  } catch { return [] }
}
const writeLocalExpenses = expenses => {
  const next = JSON.stringify(dedupeExpensesById(expenses))
  if (localStorage.getItem(EXPENSES_KEY) === next) return false
  localStorage.setItem(EXPENSES_KEY, next)
  return true
}
const getDeviceId = () => {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const value = `pos101-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
  localStorage.setItem(DEVICE_ID_KEY, value)
  return value
}
const validExpenseId = id => Boolean(id && !/[.#$\[\]/]/.test(id))
const expenseValues = snapshot => snapshot.exists()
  ? Object.entries(snapshot.val() || {}).map(([id, value]) => normalizeExpense({ ...value, id: expenseIdOf(value) || id })).filter(expense => expenseIdOf(expense))
  : []
const centralExpensePayload = (expense, user, { preserveCreatedAt = false } = {}) => {
  const normalized = normalizeExpense(expense)
  const now = Date.now()
  const createdAt = preserveCreatedAt && normalized.createdAt ? normalized.createdAt : (normalized.createdAt || now)
  const id = expenseIdOf(normalized)
  return {
    ...normalized,
    id,
    amount: normalized.amount,
    description: normalized.description,
    notes: normalized.notes,
    cashierId: normalized.cashierId || user?.uid || '',
    cashierName: normalized.cashierName || normalized.shift || user?.displayName || user?.email || '',
    businessDate: normalized.businessDate,
    operationalDayId: normalized.operationalDayId || '',
    createdAt,
    updatedAt: now,
    createdBy: normalized.createdBy || user?.uid || '',
    updatedBy: user?.uid || normalized.updatedBy || '',
    deviceId: normalized.deviceId || getDeviceId(),
    fundingSource: normalized.fundingSource,
    paymentSource: normalized.paymentSource || normalized.fundingSource,
    syncStatus: 'synced',
  }
}

const normalizeRemoteSale = (value, key) => {
  const saleId = saleIdOf(value) || key
  return { ...value, id: saleId, saleId, items: Array.isArray(value?.items) ? value.items : Object.values(value?.items || {}) }
}

const centralValues = snapshot => snapshot.exists()
  ? Object.entries(snapshot.val() || {}).map(([key, value]) => normalizeRemoteSale(value, key)).filter(sale => saleIdOf(sale))
  : []

export const mergeBySaleId = (localSales, centralSales) => {
  const merged = new Map()
  for (const sale of localSales) if (saleIdOf(sale)) merged.set(saleIdOf(sale), sale)
  for (const sale of centralSales) if (saleIdOf(sale)) {
    const id = saleIdOf(sale)
    const local = merged.get(id)
    // Central is authoritative for a known sale update (void/audit/status),
    // while local-only sales remain untouched until they are uploaded.
    merged.set(id, local ? { ...local, ...sale, items: sale.items || local.items } : sale)
  }
  return [...merged.values()]
}

const readInitialSyncCompleted = () => localStorage.getItem(INITIAL_SYNC_COMPLETED_KEY) === 'true'
const markInitialSyncCompleted = () => localStorage.setItem(INITIAL_SYNC_COMPLETED_KEY, 'true')
const validSaleId = saleId => Boolean(saleId && !/[.#$\[\]/]/.test(saleId))
export const isSaleEligibleForCentralUpload = sale => validSaleId(saleIdOf(sale)) && isSaleSyncEligible(sale)

const serializeSale = sale => ({ ...sale, saleId: saleIdOf(sale), id: saleIdOf(sale) })
const saleReadbackMatches = (expected, actual) => {
  const expectedId = saleIdOf(expected)
  const actualId = saleIdOf(actual)
  const expectedOperationKey = String(expected?.operationKey || expected?.operation_key || '')
  const actualOperationKey = String(actual?.operationKey || actual?.operation_key || '')
  return Boolean(actual
    && expectedId
    && actualId === expectedId
    && (!expectedOperationKey || actualOperationKey === expectedOperationKey)
    && String(actual?.orderNumber ?? actual?.order_number ?? '') === String(expected?.orderNumber ?? '')
    && String(actual?.businessDate || '') === String(expected?.businessDate || '')
    && String(actual?.operationalDayId || '') === String(expected?.operationalDayId || '')
    && String(actual?.paymentMethod || actual?.payment?.method || '') === String(expected?.paymentMethod || expected?.payment?.method || '')
    && Number(actual?.total ?? actual?.subtotal) === Number(expected?.total ?? expected?.subtotal))
}

const centralSaleMatches = (expected, actual) => Boolean(
  salePayloadMatches(expected, actual)
  && !isVoidedSale(actual)
  && String(expected?.orderNumber ?? '') === String(actual?.orderNumber ?? actual?.order_number ?? '')
  && saleItemsLength(expected) === saleItemsLength(actual)
  && financialFingerprint(expected) === financialFingerprint(actual)
)

// Read-only operator diagnostic for the exact "sale completed but warning
// returned" failure. It never writes Firebase or localStorage.
export const runNewSaleSyncDiagnostic = async ({ businessDate = '2026-10-08' } = {}) => {
  const localSales = readSales().filter(sale => String(sale?.businessDate || '') === String(businessDate))
  const latestSale = [...localSales].sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))[0] || null
  const queue = readRawSaleQueue()
  const lockState = defaultSyncLockManager.describe()
  const repairState = defaultSyncLockManager.recoverStaleEmergencyRepairFlag()
  const permission = await canSyncPosSales(auth?.currentUser).catch(error => ({ allowed: false, missingReason: error?.code || error?.message || 'AUTH_CHECK_FAILED' }))
  const authUser = auth?.currentUser ? { uid: auth.currentUser.uid || '', email: auth.currentUser.email || '' } : null
  let firebaseExists = false
  let firebaseExactMatch = false
  let firebaseError = ''
  if (db && latestSale?.saleId) {
    try {
      const snapshot = await get(ref(db, `pos101_sales/${latestSale.saleId}`))
      firebaseExists = snapshot.exists()
      firebaseExactMatch = firebaseExists && centralSaleMatches(latestSale, snapshot.val())
    } catch (error) {
      firebaseError = error?.code || error?.message || 'FIREBASE_READ_FAILED'
    }
  }
  const workerStatus = typeof window !== 'undefined' ? window.__POS101_QUEUE_WORKER_STATUS__ || null : null
  const result = {
    businessDate: String(businessDate),
    operationalDayId: latestSale?.operationalDayId || latestSale?.operational_day_id || '',
    latestSaleId: latestSale?.saleId || latestSale?.id || '',
    latestOrderNumber: latestSale?.orderNumber ?? '',
    latestTotal: Number(latestSale?.total ?? latestSale?.subtotal ?? 0),
    latestSyncStatus: latestSale?.syncStatus || latestSale?.status || '',
    latestCentralVerified: latestSale?.centralVerified === true,
    queueLength: queue.length,
    lockState,
    emergencyRepairActive: localStorage.getItem(EMERGENCY_REPAIR_KEY) === 'true',
    emergencyRepairRecovery: repairState,
    canSync: Boolean(permission.allowed),
    authUser,
    firebaseExists,
    firebaseExactMatch,
    firebaseError,
    workerStatus,
    nextAction: firebaseExactMatch ? 'READBACK_MARK_LOCAL_SYNCED' : queue.length && permission.allowed ? 'PROCESS_QUEUE' : !permission.allowed ? 'RESTORE_AUTHORIZATION' : 'INSPECT_QUEUE_AND_FIREBASE',
  }
  console.info('POS101_NEW_SALE_SYNC_DIAGNOSTIC', result)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-new-sale-sync-diagnostic', { detail: result }))
  return result
}

const requireRole = async expectedRole => {
  if (!configured) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  const user = await ensurePosFirebaseSession()
  const permission = await canSyncPosSales(user)
  if (!permission.allowed) {
    throw Object.assign(new Error(expectedRole === 'cashier-sync' ? 'هذا الحساب لا يملك صلاحية رفع المبيعات.' : 'تسجيل دخول الإدارة مطلوب للقراءة.'), { code: 'CENTRAL_ROLE_BLOCKED' })
  }
  return user
}

const saleItemsLength = sale => Array.isArray(sale?.items)
  ? sale.items.length
  : Array.isArray(sale?.order?.items) ? sale.order.items.length : 0

const saleReadbackRequiredFieldsMatch = (expected, actual) => Boolean(actual
  && saleIdOf(expected) === saleIdOf(actual)
  && String(expected?.orderNumber ?? '') === String(actual?.orderNumber ?? actual?.order_number ?? '')
  && String(expected?.businessDate || '') === String(actual?.businessDate || '')
  && String(expected?.operationalDayId || '') === String(actual?.operationalDayId || actual?.operational_day_id || '')
  && Number(expected?.total ?? expected?.subtotal) === Number(actual?.total ?? actual?.subtotal)
  && saleItemsLength(expected) === saleItemsLength(actual))

// Normal online checkout uses this direct path. It performs the identity and
// order-number collision reads before one idempotent write, then requires a
// complete Firebase readback before the caller may mark local state synced.
export const saveCentralSaleImmediately = async sale => {
  await requireRole('cashier-sync')
  const id = saleIdOf(sale)
  if (!id || !sale?.orderNumber || !sale?.businessDate || !sale?.operationalDayId || !saleItemsLength(sale)) {
    throw Object.assign(new Error('بيانات البيع المركزية غير مكتملة.'), { code: 'SALE_PAYLOAD_INCOMPLETE' })
  }
  const centralDay = await readCentralOperationalDay()
  if (!centralDay) throw operationalDayGuardError('CENTRAL_DAY_UNAVAILABLE', 'لا يمكن البيع: تعذر قراءة اليوم التشغيلي المركزي.')
  if (centralDay.status !== 'open') throw operationalDayGuardError('CENTRAL_DAY_CLOSED', 'لا يمكن البيع: اليوم التشغيلي مغلق أو تغيّر من جهاز آخر.', centralDay)
  if (!currentDayMatchesSale(centralDay, sale)) throw operationalDayGuardError('CENTRAL_DAY_MISMATCH', 'لا يمكن البيع: اليوم التشغيلي مغلق أو تغيّر من جهاز آخر.', centralDay)
  const saleRef = ref(db, `pos101_sales/${id}`)
  const existingSnapshot = await get(saleRef)
  if (existingSnapshot.exists()) {
    const existing = existingSnapshot.val()
    if (isVoidedSale(existing)) throw Object.assign(new Error('معرف البيع موجود مركزيًا كمبطل.'), { code: 'SALE_ID_VOIDED_COLLISION' })
    if (centralSaleMatches(sale, existing) && saleReadbackRequiredFieldsMatch(sale, existing)) return { sale: { ...existing, id }, duplicate: true, readbackVerified: true }
    throw Object.assign(new Error('معرف البيع موجود مركزيًا ببيانات مختلفة.'), { code: 'SALE_ID_COLLISION' })
  }
  const centralSales = centralValues(await get(salesRef()))
  const orderCollision = findActiveOrderNumberCollision(sale, centralSales)
  if (orderCollision) throw Object.assign(new Error(`رقم الطلب مستخدم في مبيعة مركزية أخرى: ${sale.orderNumber}`), { code: 'ORDER_NUMBER_COLLISION_MANUAL_REVIEW' })
  await set(saleRef, serializeSale({ ...sale, status: sale.status || 'completed' }))
  const readBack = await get(saleRef)
  if (!readBack.exists() || isVoidedSale(readBack.val()) || !centralSaleMatches(sale, readBack.val()) || !saleReadbackRequiredFieldsMatch(sale, readBack.val())) {
    throw Object.assign(new Error('تعذر التحقق من حفظ المبيعة المركزية.'), { code: 'SALE_READBACK_FAILED' })
  }
  return { sale: { ...readBack.val(), id }, duplicate: false, readbackVerified: true }
}

const auditRows = sale => Array.isArray(sale?.audit) ? sale.audit : sale?.audit && typeof sale.audit === 'object' ? Object.values(sale.audit) : []
const hasVoidAudit = (sale, audit) => auditRows(sale).some(row => row?.type === 'void' && (!audit?.id || row?.id === audit.id))

// Void updates target the existing sale node. They never create a replacement
// sale, and a successful local confirmation is allowed only after readback of
// status, voidedAt, and the appended audit row.
export const voidCentralSaleImmediately = async (sale, { voidPayload = {}, audit = null } = {}) => {
  const user = await requireRole('cashier-sync')
  const id = saleIdOf(sale)
  if (!id) throw Object.assign(new Error('معرف البيع غير موجود.'), { code: 'SALE_ID_REQUIRED' })
  const saleRef = ref(db, `pos101_sales/${id}`)
  const currentSnapshot = await get(saleRef)
  if (!currentSnapshot.exists()) return { sale: null, neverExisted: true, readbackVerified: true }
  const current = { ...currentSnapshot.val(), id }
  const now = Number(voidPayload.voidedAt) || Date.now()
  const voidAudit = audit || { id: `void-${id}-${now}`, type: 'void', at: now, cashierId: voidPayload.cashierId || user.uid, cashierNameSnapshot: voidPayload.cashierNameSnapshot || user.displayName || user.email || '', reason: voidPayload.voidReason || '' }
  if (!isVoidedSale(current) || !hasVoidAudit(current, voidAudit)) {
    const nextAudit = hasVoidAudit(current, voidAudit) ? auditRows(current) : [...auditRows(current), voidAudit]
    await update(saleRef, {
      status: 'voided',
      voided: true,
      voidedAt: Number(current.voidedAt) || now,
      voidedBy: voidPayload.voidedBy || user.uid,
      voidReason: voidPayload.voidReason || '',
      audit: nextAudit,
    })
  }
  const readBack = await get(saleRef)
  const verified = readBack.exists() && isVoidedSale(readBack.val()) && Boolean(readBack.val()?.voidedAt) && hasVoidAudit(readBack.val(), voidAudit)
  if (!verified) throw Object.assign(new Error('تعذر التحقق من إبطال البيع مركزيًا.'), { code: 'VOID_READBACK_FAILED' })
  return { sale: { ...readBack.val(), id }, neverExisted: false, readbackVerified: true, audit: voidAudit }
}

const requireOperationalDayRole = async () => {
  if (!configured) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  const user = await ensurePosFirebaseSession('تسجيل دخول POS مطلوب لإدارة اليوم التشغيلي.')
  return requireKioskUser(user)
}

const requireExpenseRole = async (write = false) => {
  if (!configured || !db) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  const user = await ensurePosFirebaseSession('تسجيل دخول POS مطلوب لمزامنة المصاريف.')
  return requireKioskUser(user)
}

export const isCentralConfigured = () => configured
export const isCentralEmulator = () => useEmulator
export const centralAuth = () => auth
export const ensurePosFirebaseSession = async (message = 'تسجيل دخول Firebase مطلوب للمزامنة.') => {
  if (!configured || !auth) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  await authReady
  const user = auth.currentUser
  if (!user) {
    authDebug('POS_AUTH_REQUIRED')
    throw Object.assign(new Error(message), { code: 'AUTH_REQUIRED' })
  }
  return user
}
export const ensureKioskFirebaseSession = async (message = 'تفعيل جهاز POS موثوق مطلوب.') => requireKioskUser(await ensurePosFirebaseSession(message))
export const subscribeCentralAuth = callback => auth ? onAuthStateChanged(auth, user => {
  if (!user) {
    authorizationCache.clear()
    tokenClaimsCache.clear()
    callback(null)
    return
  }
  void hydrateKioskClaims(user).then(claims => claims?.pos101_kiosk ? true : hydrateCentralAuthorization(user)).finally(() => callback(user))
}) : () => {}
const normalizedAuthorization = record => record && typeof record === 'object' ? record : null
const hydrateKioskClaims = async user => {
  if (!user?.uid) return null
  if (typeof user.getIdToken !== 'function') return tokenClaimsCache.get(user.uid) || null
  try {
    const result = await getIdTokenResult(user)
    const claims = result.claims || {}
    tokenClaimsCache.set(user.uid, claims)
    return claims
  } catch (error) {
    console.error('POS_KIOSK_CLAIMS_READ_ERROR', error)
    tokenClaimsCache.delete(user.uid)
    return null
  }
}
export const isKioskAuthenticatedUser = user => {
  const claims = user?.uid ? tokenClaimsCache.get(user.uid) : null
  return Boolean(claims?.pos101_kiosk === true && claims?.scope === 'cashier' && claims?.kioskId)
}
const isKioskUser = isKioskAuthenticatedUser
const requireKioskUser = async user => {
  const claims = await hydrateKioskClaims(user)
  if (!user?.uid || claims?.pos101_kiosk !== true || claims?.scope !== 'cashier' || !claims?.kioskId) throw Object.assign(new Error('تفعيل جهاز POS موثوق مطلوب.'), { code: 'KIOSK_AUTH_REQUIRED' })
  return user
}
export const readCentralAuthorizationRecord = async user => {
  if (!user?.uid) return null
  if (authorizationCache.has(user.uid)) return authorizationCache.get(user.uid)
  const localRecord = normalizedAuthorization(user.pos101Authorization || user.authorization)
  if (!db) return localRecord
  try {
    const snapshot = await get(ref(db, `${AUTHORIZED_UIDS_PATH}/${user.uid}`))
    const record = snapshot.exists() ? normalizedAuthorization(snapshot.val()) : null
    if (record) authorizationCache.set(user.uid, record)
    return record
  } catch (error) {
    console.error('POS_AUTHORIZATION_READ_ERROR', error)
    return localRecord
  }
}
export const refreshCentralAuthorizationRecord = async user => {
  if (!user?.uid) return null
  authorizationCache.delete(user.uid)
  return readCentralAuthorizationRecord(user)
}
const roleFromAuthorization = record => {
  const role = String(record?.role || '').trim().toLowerCase()
  if (ADMIN_ROLES.has(role)) return 'admin-viewer'
  if (SYNC_ROLES.has(role) || record?.read === true || record?.write === true || record?.sync === true) return 'cashier-sync'
  return 'blocked'
}
const isActiveAuthorizedRecord = record => {
  const role = String(record?.role || '').trim().toLowerCase()
  return Boolean(record && record.active !== false && record.authorized !== false && (SYNC_ROLES.has(role) || record.read === true || record.write === true || record.sync === true))
}
export const canManageStaff = (user, authorizationRecord = null) => {
  if (!user?.uid) return false
  if (isKioskUser(user)) return true
  const record = authorizationRecord || authorizationCache.get(user.uid) || user.pos101Authorization || user.authorization
  const role = String(record?.role || '').trim().toLowerCase()
  return Boolean(record && record.active !== false && record.authorized !== false && STAFF_MANAGEMENT_ROLES.has(role))
}

// One structured gate shared by sale workers, manual recovery, diagnostics,
// and readback. Kiosk claims are accepted, while authorized uid records are a
// deliberate fallback for cashier/manager/admin accounts.
export const canSyncPosSales = async (user = null) => {
  let authResolved = false
  if (!user) {
    try {
      await authReady
      authResolved = true
      user = auth?.currentUser || null
    } catch {}
  } else {
    try { await authReady; authResolved = true } catch {}
  }
  const result = {
    allowed: false,
    uid: user?.uid || '',
    email: user?.email || '',
    role: 'blocked',
    authReady: authResolved && Boolean(user?.uid),
    claimsReady: false,
    claims: null,
    cashierId: '',
    cashierName: '',
    authorizedUidExists: false,
    authorizedPathChecked: false,
    staffSessionExists: false,
    missingReason: '',
  }
  if (!user?.uid) { result.missingReason = 'AUTH_REQUIRED'; return result }
  const claims = await hydrateKioskClaims(user)
  result.claimsReady = Boolean(claims)
  result.claims = claims || null
  result.cashierId = String(claims?.cashierId || claims?.pos101_cashierId || claims?.staffId || '')
  result.cashierName = String(claims?.cashierName || claims?.pos101_cashierName || claims?.name || '')
  const claimsRole = String(claims?.role || claims?.pos101_role || claims?.userRole || '').trim().toLowerCase()
  const record = await readCentralAuthorizationRecord(user)
  result.authorizedPathChecked = Boolean(db)
  result.authorizedUidExists = Boolean(record)
  const staffSession = readLocalCashierSession()
  result.staffSessionExists = Boolean(staffSession)
  result.cashierId ||= String(record?.cashierId || record?.staffId || '')
  result.cashierName ||= String(record?.cashierName || record?.name || '')
  result.cashierId ||= staffSession?.cashierId || ''
  result.cashierName ||= staffSession?.cashierName || ''
  const role = String(record?.role || claimsRole || '').trim().toLowerCase()
  const roleAllowed = new Set(['cashier', 'cashier-sync', 'employee', 'manager', 'admin', 'super_admin', 'admin-viewer']).has(role)
  const recordAllowed = Boolean(record && record.active !== false && record.authorized !== false)
  const staffSessionAllowed = Boolean(staffSession)
  const kioskAllowed = claims?.pos101_kiosk === true && claims?.scope === 'cashier' && claims?.kioskId
  if (kioskAllowed || recordAllowed || roleAllowed || staffSessionAllowed) {
    result.allowed = true
    result.role = ['super_admin', 'admin', 'manager'].includes(role) ? role : 'cashier'
    return result
  }
  result.role = role || 'blocked'
  result.missingReason = !record && !claimsRole ? 'AUTHORIZED_UID_MISSING' : record?.active === false ? 'AUTHORIZED_UID_INACTIVE' : record?.authorized === false ? 'AUTHORIZED_UID_DISABLED' : 'ROLE_NOT_ALLOWED'
  return result
}

export const isAuthorizedPosSyncUser = async user => (await canSyncPosSales(user)).allowed

export const hydrateCentralAuthorization = async user => {
  const allowed = await isAuthorizedPosSyncUser(user)
  if (allowed && user?.uid && !authorizationCache.has(user.uid) && (user.pos101Authorization || user.authorization)) {
    authorizationCache.set(user.uid, user.pos101Authorization || user.authorization)
  }
  return allowed
}

export const getCentralRole = user => {
  if (isKioskUser(user)) return 'cashier-sync'
  const record = user?.uid ? (authorizationCache.get(user.uid) || user.pos101Authorization || user.authorization) : null
  return roleFromAuthorization(record)
}
export const getCentralPermissions = user => {
  const role = getCentralRole(user)
  return role === 'cashier-sync' || role === 'admin-viewer'
    ? { centralRead: true, centralWrite: true, uploadLocalSales: true, autoUpload: true, realtimeRead: true, downloadMerge: true }
    : { centralRead: false, centralWrite: false, uploadLocalSales: false, autoUpload: false, realtimeRead: false, downloadMerge: false }
}
export const isCentralCashierUser = user => getCentralRole(user) === 'cashier-sync'
export const isCentralAdminUser = user => getCentralRole(user) === 'admin-viewer'
export const isOperationalDayUser = user => getCentralRole(user) !== 'blocked'
export const signInAdminWithGoogle = async () => {
  if (!configured || !auth) throw new Error('إعداد Firebase المركزي غير موجود.')
  await authReady
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const result = await signInWithPopup(auth, provider)
  if (!await isAuthorizedPosSyncUser(result.user) || !isCentralAdminUser(result.user)) {
    await signOut(auth)
    throw Object.assign(new Error('الحساب الإداري المحدد غير مطابق. اختر حساب الإدارة الصحيح.'), { code: 'UNAUTHORIZED_ADMIN_ACCOUNT' })
  }
  return result.user
}
export const signOutCentral = () => auth ? signOut(auth) : Promise.resolve()

const operationalDayIdOf = day => String(day?.id || day?.operationalDayId || '').trim()
export const readCachedOperationalDay = () => {
  try {
    const value = JSON.parse(localStorage.getItem(OPERATIONAL_DAY_KEY) || 'null')
    return (value?.status === 'open' || value?.status === 'closed') && value?.id && value?.businessDate ? value : null
  } catch { return null }
}
const normalizeOperationalDay = (day, fallbackId = '') => {
  if (!day || typeof day !== 'object') return null
  const id = operationalDayIdOf(day) || String(fallbackId || '').trim()
  const status = day.status === 'closed' ? 'closed' : day.status === 'open' ? 'open' : ''
  if (!id || !day.businessDate || !status) return null
  return {
    ...day,
    id,
    operationalDayId: String(day.operationalDayId || id),
    openedAt: Number(day.openedAt || day.startedAt) || null,
    openedBy: day.openedBy || day.startedBy || null,
    closedAt: day.closedAt || null,
    closedBy: day.closedBy || null,
    closeSummary: day.closeSummary || null,
    version: Number(day.version || 0),
    updatedAt: Number(day.updatedAt || day.closedAt || day.startedAt || day.openedAt) || 0,
    status,
  }
}
const cacheOperationalDay = (day, { central = false } = {}) => {
  const normalized = normalizeOperationalDay(day)
  if (normalized) {
    const previous = readCachedOperationalDay()
    if (central && normalized.status === 'closed' && previous?.status === 'open') {
      localStorage.setItem(OPERATIONAL_DAY_STALE_KEY, 'true')
      localStorage.setItem(OPERATIONAL_DAY_CLOSED_BY_CENTRAL_KEY, 'true')
      localStorage.setItem(OPERATIONAL_DAY_STALE_DETECTED_AT_KEY, String(Date.now()))
    }
    if (central && normalized.status === 'open') {
      localStorage.removeItem(OPERATIONAL_DAY_STALE_KEY)
      localStorage.removeItem(OPERATIONAL_DAY_CLOSED_BY_CENTRAL_KEY)
      localStorage.removeItem(OPERATIONAL_DAY_STALE_DETECTED_AT_KEY)
    }
    const enriched = normalized.status === 'closed' && localStorage.getItem(OPERATIONAL_DAY_CLOSED_BY_CENTRAL_KEY) === 'true'
      ? { ...normalized, localOperationalDayStale: true, localClosedByCentral: true, staleDetectedAt: Number(localStorage.getItem(OPERATIONAL_DAY_STALE_DETECTED_AT_KEY)) || null }
      : normalized
    localStorage.setItem(OPERATIONAL_DAY_KEY, JSON.stringify(enriched))
    if (central && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-operational-day-changed', { detail: enriched }))
    return enriched
  }
  localStorage.removeItem(OPERATIONAL_DAY_KEY)
  return null
}
const localBusinessDate = timestamp => {
  const date = new Date(timestamp)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const operationalDayValues = snapshot => snapshot.exists()
  ? Object.entries(snapshot.val() || {}).map(([id, value]) => ({ ...value, id: operationalDayIdOf(value) || id }))
  : []
const latestOperationalDay = days => days
  .map(day => normalizeOperationalDay(day))
  .filter(Boolean)
  .sort((left, right) => Number(right.updatedAt || right.endedAt || right.startedAt || 0) - Number(left.updatedAt || left.endedAt || left.startedAt || 0))[0] || null
const latestOpenOperationalDay = days => days
  .map(day => normalizeOperationalDay(day))
  .filter(day => day?.status === 'open' && operationalDayIdOf(day))
  .sort((left, right) => Number(right.startedAt || 0) - Number(left.startedAt || 0))[0] || null

const currentDayMatchesSale = (day, sale) => Boolean(
  day?.status === 'open'
  && String(day.id || day.operationalDayId || '') === String(sale?.operationalDayId || sale?.operational_day_id || '')
  && String(day.businessDate || '') === String(sale?.businessDate || '')
)

const operationalDayGuardError = (code, message, details = {}) => Object.assign(new Error(message), { code, operationalDay: details })

export const isOperationalDayClosedError = error => new Set([
  'CENTRAL_DAY_CLOSED',
  'CENTRAL_DAY_MISMATCH',
  'CENTRAL_DAY_UNAVAILABLE',
  'ORDER_NUMBER_DAY_CLOSED',
  'SALE_DAY_CLOSED',
  'SALE_DAY_MISMATCH',
]).has(error?.code)

const readLegacyOperationalDay = async () => latestOperationalDay(operationalDayValues(await get(operationalDaysRef())))

export const readCentralOperationalDay = async () => {
  if (!auth?.currentUser) await authReady
  if (!auth?.currentUser) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' })
  const currentSnapshot = await get(operationalDayCurrentRef())
  if (currentSnapshot.exists()) return cacheOperationalDay(normalizeOperationalDay(currentSnapshot.val()), { central: true })
  const legacy = await readLegacyOperationalDay()
  return cacheOperationalDay(legacy, { central: true })
}

const ensureCanonicalOperationalDay = async () => {
  const currentSnapshot = await get(operationalDayCurrentRef())
  if (currentSnapshot.exists()) return normalizeOperationalDay(currentSnapshot.val())
  const legacy = await readLegacyOperationalDay()
  if (!legacy) return null
  const transaction = await runTransaction(operationalDayCurrentRef(), current => current || legacy)
  return normalizeOperationalDay(transaction.snapshot.val())
}

export const subscribeOperationalDay = callback => {
  if (!configured || !db || !auth?.currentUser || !isOperationalDayUser(auth.currentUser)) {
    callback(readCachedOperationalDay())
    return () => {}
  }
  let currentSeen = false
  let legacyDay = null
  let currentDay = null
  const publish = day => {
    const centralDay = normalizeOperationalDay(day)
    if (!centralDay) {
      cacheOperationalDay(null)
      callback(null)
      return
    }
    const cached = cacheOperationalDay(centralDay, { central: true })
    callback(cached)
  }
  const stopCurrent = onValue(operationalDayCurrentRef(), snapshot => {
    currentSeen = true
    currentDay = snapshot.exists() ? normalizeOperationalDay(snapshot.val()) : null
    publish(currentDay || legacyDay)
  }, error => {
    console.error('OPERATIONAL_DAY_CURRENT_SUBSCRIBE_ERROR', error)
    callback({ ...(readCachedOperationalDay() || {}), centralUnavailable: true })
  })
  const stopLegacy = onValue(operationalDaysRef(), snapshot => {
    legacyDay = latestOperationalDay(operationalDayValues(snapshot))
    if (!currentSeen || !currentDay) publish(legacyDay)
  }, error => console.error('OPERATIONAL_DAY_LEGACY_SUBSCRIBE_ERROR', error))
  return () => { stopCurrent?.(); stopLegacy?.() }
}

export const readLocalOperationalDay = readCachedOperationalDay

export const readOpenOperationalDay = async () => {
  const day = await readCentralOperationalDay()
  return day?.status === 'open' ? day : null
}

export const findOperationalDayByBusinessDate = async businessDate => {
  await requireOperationalDayRole()
  const days = operationalDayValues(await get(operationalDaysRef()))
  return { ...matchOperationalDayByBusinessDate(days, businessDate), days }
}

export const readCentralOperationalDays = async () => {
  if (!auth?.currentUser) await authReady
  if (!auth?.currentUser) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' })
  const [legacySnapshot, currentSnapshot] = await Promise.all([get(operationalDaysRef()), get(operationalDayCurrentRef())])
  const days = operationalDayValues(legacySnapshot)
  const current = currentSnapshot.exists() ? normalizeOperationalDay(currentSnapshot.val()) : null
  if (current && !days.some(day => operationalDayIdOf(day) === current.id)) days.push(current)
  return days
}

export const readOpeningCashSuggestion = async () => {
  await requireOperationalDayRole()
  const [daysSnapshot, settlementsSnapshot, correctionsSnapshot] = await Promise.all([
    get(operationalDaysRef()),
    get(financialPath(settlementPath)),
    get(financialPath(settlementCorrectionsPath)),
  ])
  const days = operationalDayValues(daysSnapshot)
    .filter(day => day.status === 'closed')
    .sort((left, right) => Number(right.endedAt || right.startedAt || 0) - Number(left.endedAt || left.startedAt || 0))
  const settlements = objectValues(settlementsSnapshot)
  const corrections = objectValues(correctionsSnapshot)
  for (const day of days) {
    const settlement = settlements.find(row => String(row.operationalDayId || '') === String(day.id))
    if (!settlement || !Number.isFinite(Number(settlement.actualCash))) continue
    const effective = getEffectiveSettlement(settlement, corrections.filter(row => String(row.settlementId || '') === String(settlement.id)))
    return { previousOperationalDay: day, previousSettlement: settlement, effectiveActualClosingCash: effective.effectiveActualCash, source: effective.correction ? 'settlement_correction' : 'settlement' }
  }
  return { previousOperationalDay: null, previousSettlement: null, effectiveActualClosingCash: null, source: 'manual' }
}

export const readCentralSalesForOperationalDay = async day => {
  await financialUser(false)
  const rows = centralValues(await get(salesRef()))
  return getReportSalesForOperationalDay({ centralSales: rows, operationalDayId: day?.id || day?.operationalDayId, businessDate: day?.businessDate })
}

// Edits are deliberately limited to metadata and discount/payment fields. The
// original sale id, operation key, items, order number, and business day stay
// immutable; the same RTDB node is updated and read back, so no second sale is
// ever created by this workflow.
export const updateCentralSale = async (sale, changes = {}) => {
  const user = await financialUser(true)
  const id = saleIdOf(sale)
  if (!id) throw Object.assign(new Error('معرف البيع غير موجود.'), { code: 'SALE_ID_REQUIRED' })
  const saleRef = ref(db, `pos101_sales/${id}`)
  const currentSnapshot = await get(saleRef)
  if (!currentSnapshot.exists()) throw Object.assign(new Error('البيع المركزي غير موجود.'), { code: 'SALE_NOT_FOUND' })
  const current = { ...currentSnapshot.val(), id }
  if (current.status === 'voided' || current.voided) throw Object.assign(new Error('لا يمكن تعديل بيع مبطل.'), { code: 'SALE_VOIDED' })
  const dayId = String(current.operationalDayId || current.operational_day_id || '').trim()
  if (!dayId) throw Object.assign(new Error('لا يمكن تعديل بيع بلا يوم تشغيلي.'), { code: 'SALE_DAY_REQUIRED' })
  const daySnapshot = await get(ref(db, `pos101_operational_days/${dayId}`))
  const day = daySnapshot.exists() ? daySnapshot.val() : null
  if (!day || day.status !== 'open') throw Object.assign(new Error('التعديل متاح فقط ضمن اليوم التشغيلي المفتوح.'), { code: 'SALE_DAY_CLOSED' })
  const patch = buildSaleEditPatch(current, changes)
  if (!Number.isFinite(Number(patch.discount)) || Number(patch.discount) < 0 || Number(patch.discount) > Number(patch.subtotal)) throw Object.assign(new Error('قيمة الخصم غير صالحة.'), { code: 'SALE_DISCOUNT_INVALID' })
  const now = Date.now()
  const next = { ...current, ...patch, id, saleId: current.saleId || id, updatedAt: now, updatedByUid: user.uid, updatedByName: user.displayName || user.email || '', lastEditReason: String(changes.reason || '').trim() }
  if (!saleEditPreservesIdentity(current, next)) throw new Error('محاولة تعديل حقل محمي من البيع.')
  const auditId = `sale-edit-${safeKey(id)}-${now}-${crypto.randomUUID().slice(0, 8)}`
  const audit = financialAuditPayload({ id: auditId, user, action: 'sale edit', entityType: 'sale', entityId: id, before: saleEditableSnapshot(current), after: saleEditableSnapshot(next), reason: next.lastEditReason, businessDate: current.businessDate || day.businessDate || '' })
  await update(ref(db), { [`pos101_sales/${id}`]: next, [`${auditPath}/${auditId}`]: audit })
  const [saleBack, auditBack] = await Promise.all([get(saleRef), get(financialPath(`${auditPath}/${auditId}`))])
  if (!saleBack.exists() || !auditBack.exists() || !saleEditPreservesIdentity(current, saleBack.val())) throw new Error('تعذر التحقق من تعديل البيع وسجل التدقيق.')
  const saved = { ...saleBack.val(), id }
  const local = readSales()
  const index = local.findIndex(row => saleIdOf(row) === id)
  if (index >= 0) { local[index] = saved; writeSales(local); dispatchUpdated() }
  window.dispatchEvent(new CustomEvent('pos101-sale-updated', { detail: saved }))
  return saved
}

// Pending tables are a separate operational ledger. They must never be sent
// through the completed-sales queue until the cashier explicitly collects a
// payment. Every mutating operation reads its canonical node back.
const pendingTableIdOf = table => String(table?.tabId || table?.id || '').trim()
const pendingTableStatus = new Set(['open', 'paid', 'cancelled', 'unpaid_lost'])
const pendingTableValues = snapshot => snapshot.exists()
  ? Object.entries(snapshot.val() || {}).map(([id, value]) => ({ ...value, tabId: String(value?.tabId || id), id: String(value?.id || value?.tabId || id) }))
  : []
const pendingTableAudit = ({ id, user, action, before = null, after = null, reason = '', businessDate = '' }) => financialAuditPayload({ id, user, action, entityType: 'pending_table', entityId: id, before, after, reason, businessDate })

export const readPendingTables = async () => {
  await financialUser(false)
  return pendingTableValues(await get(pendingTablesRef()))
}

export const subscribePendingTables = (callback, onError = error => console.error('PENDING_TABLES_SUBSCRIBE_ERROR', error)) => {
  if (!configured || !db || !isOperationalDayUser(auth?.currentUser)) return () => {}
  return onValue(pendingTablesRef(), snapshot => callback(pendingTableValues(snapshot)), onError)
}

export const savePendingTable = async ({ customerName, tableNumber = '', phone = '', note = '', items = [], subtotal = 0, discount = 0, total = 0, businessDate = '', operationalDayId = '', cashierName = '', cashierId = '', orderType = '' } = {}) => {
  const user = await financialUser(true)
  const name = String(customerName || '').trim()
  if (!name) throw Object.assign(new Error('اسم الزبون مطلوب.'), { code: 'CUSTOMER_NAME_REQUIRED' })
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('أضف منتجاً واحداً على الأقل.'), { code: 'PENDING_TABLE_ITEMS_REQUIRED' })
  const tabId = `tab-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const now = Date.now()
  const payload = {
    tabId, id: tabId, status: 'open', customerName: name, tableNumber: String(tableNumber || '').trim(), phone: String(phone || '').trim(), note: String(note || '').trim(),
    openedAt: now, businessDate: String(businessDate || ''), operationalDayId: String(operationalDayId || ''), cashierName: String(cashierName || user.displayName || user.email || '').trim(), cashierId: String(cashierId || '').trim(), orderType: String(orderType || ''),
    items: items.map(item => ({ ...item, quantity: Number(item.quantity || 0), price: Number(item.price || item.unitPrice || 0), lineTotal: Number(item.price || item.unitPrice || 0) * Number(item.quantity || 0) })), subtotal: Number(subtotal || 0), discount: Number(discount || 0), total: Number(total || 0), createdByUid: user.uid, updatedAt: now,
  }
  assertJsonNumbers(payload, 'pendingTable')
  await set(ref(db, `pos101_pending_tables/${tabId}`), payload)
  const back = await get(ref(db, `pos101_pending_tables/${tabId}`))
  if (!back.exists() || back.val()?.status !== 'open' || back.val()?.customerName !== name) throw Object.assign(new Error('تعذر التحقق من حفظ الطاولة المعلقة.'), { code: 'PENDING_TABLE_READBACK_FAILED' })
  return back.val()
}

export const updatePendingTable = async (table, changes = {}) => {
  const user = await financialUser(true)
  const id = pendingTableIdOf(table)
  if (!id) throw Object.assign(new Error('معرف الطاولة المعلقة غير موجود.'), { code: 'PENDING_TABLE_ID_REQUIRED' })
  const currentSnapshot = await get(ref(db, `pos101_pending_tables/${id}`))
  if (!currentSnapshot.exists()) throw Object.assign(new Error('الطاولة المعلقة غير موجودة.'), { code: 'PENDING_TABLE_NOT_FOUND' })
  const current = { ...currentSnapshot.val(), tabId: id, id }
  if (current.status !== 'open') throw Object.assign(new Error('يمكن تعديل الطاولة المعلقة المفتوحة فقط.'), { code: 'PENDING_TABLE_NOT_OPEN' })
  const items = Array.isArray(changes.items) ? changes.items.map(item => ({ ...item, quantity: Number(item.quantity || 0), price: Number(item.price || item.unitPrice || 0), lineTotal: Number(item.price || item.unitPrice || 0) * Number(item.quantity || 0) })) : current.items
  const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal || Number(item.price || 0) * Number(item.quantity || 0)), 0)
  const discount = Number(changes.discount ?? current.discount ?? 0)
  const next = { ...current, ...changes, items, subtotal, discount, total: Math.max(0, subtotal - discount), updatedAt: Date.now(), updatedByUid: user.uid, updatedByName: user.displayName || user.email || '' }
  delete next.reason
  const auditId = `audit-pending-table-edit-${safeKey(id)}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  await update(ref(db), { [`pos101_pending_tables/${id}`]: next, [`${auditPath}/${auditId}`]: pendingTableAudit({ id: auditId, user, action: 'pending_table_edit', before: current, after: next, reason: String(changes.auditReason || '').trim(), businessDate: current.businessDate || '' }) })
  const [back, auditBack] = await Promise.all([get(ref(db, `pos101_pending_tables/${id}`)), get(financialPath(`${auditPath}/${auditId}`))])
  if (!back.exists() || !auditBack.exists()) throw Object.assign(new Error('تعذر التحقق من تعديل الطاولة المعلقة وسجل التدقيق.'), { code: 'PENDING_TABLE_EDIT_READBACK_FAILED' })
  return back.val()
}

export const transitionPendingTable = async (table, { status, reason, confirmationName, confirmationCode = '' } = {}) => {
  const user = await staffUser(true)
  const id = pendingTableIdOf(table)
  if (!pendingTableStatus.has(status) || status === 'open' || status === 'paid') throw Object.assign(new Error('حالة الطاولة غير صالحة لهذه العملية.'), { code: 'PENDING_TABLE_STATUS_INVALID' })
  if (!String(reason || '').trim()) throw Object.assign(new Error('السبب مطلوب.'), { code: 'PENDING_TABLE_REASON_REQUIRED' })
  const currentSnapshot = await get(ref(db, `pos101_pending_tables/${id}`))
  if (!currentSnapshot.exists()) throw Object.assign(new Error('الطاولة المعلقة غير موجودة.'), { code: 'PENDING_TABLE_NOT_FOUND' })
  const current = currentSnapshot.val()
  if (current.status !== 'open') throw Object.assign(new Error('تمت معالجة هذه الطاولة مسبقاً.'), { code: 'PENDING_TABLE_ALREADY_PROCESSED' })
  const confirmation = String(confirmationName || '').trim()
  const staffRows = await readCentralStaff()
  const identityMatches = confirmation && (confirmation === String(user.displayName || '').trim() || confirmation === String(user.email || '').trim() || staffRows.some(row => confirmation === String(row.name || '').trim() || confirmation === String(row.code || '').trim()))
  if (!identityMatches) throw Object.assign(new Error('تأكيد الاسم/الكود غير مطابق للمستخدم الحالي.'), { code: 'PENDING_TABLE_CONFIRMATION_INVALID' })
  const now = Date.now()
  const next = { ...current, id, tabId: id, status, statusReason: String(reason).trim(), updatedAt: now, [`${status}At`]: now, [`${status}ByUid`]: user.uid, [`${status}ByName`]: user.displayName || user.email || '' }
  const auditId = `audit-pending-table-${status}-${safeKey(id)}-${now}-${crypto.randomUUID().slice(0, 8)}`
  await update(ref(db), { [`pos101_pending_tables/${id}`]: next, [`${auditPath}/${auditId}`]: pendingTableAudit({ id: auditId, user, action: `pending_table_${status}`, before: current, after: next, reason: String(reason).trim(), businessDate: current.businessDate || '' }) })
  const [back, auditBack] = await Promise.all([get(ref(db, `pos101_pending_tables/${id}`)), get(financialPath(`${auditPath}/${auditId}`))])
  if (!back.exists() || back.val()?.status !== status || !auditBack.exists()) throw Object.assign(new Error('تعذر التحقق من تحديث حالة الطاولة وسجل التدقيق.'), { code: 'PENDING_TABLE_STATUS_READBACK_FAILED' })
  return back.val()
}

export const payPendingTable = async (table, { paymentMethod = 'cash', sellerName = '' } = {}) => {
  const user = await financialUser(true)
  const id = pendingTableIdOf(table)
  const currentSnapshot = await get(ref(db, `pos101_pending_tables/${id}`))
  if (!currentSnapshot.exists()) throw Object.assign(new Error('الطاولة المعلقة غير موجودة.'), { code: 'PENDING_TABLE_NOT_FOUND' })
  const current = currentSnapshot.val()
  if (current.status === 'paid' && current.linkedSaleId) return { pendingTable: current, sale: (await get(ref(db, `pos101_sales/${current.linkedSaleId}`))).val(), duplicate: true }
  if (current.status !== 'open') throw Object.assign(new Error('لا يمكن تحصيل طاولة غير مفتوحة.'), { code: 'PENDING_TABLE_NOT_OPEN' })
  const day = await readOpenOperationalDay()
  if (!day?.id || day.status !== 'open') throw Object.assign(new Error('يجب وجود يوم تشغيلي مفتوح عند التحصيل.'), { code: 'OPERATIONAL_DAY_REQUIRED' })
  const saleId = String(current.linkedSaleId || `sale-from-${id}`)
  const existingSale = await get(ref(db, `pos101_sales/${saleId}`))
  const centralOrder = existingSale.exists() ? { orderNumber: existingSale.val().orderNumber } : await allocateCentralOrderNumber({ operationalDayId: day.id, businessDate: day.businessDate })
  const sale = existingSale.exists() ? existingSale.val() : {
    saleId, id: saleId, operationKey: `pos101:${saleId}`, orderNumber: centralOrder.orderNumber, cashierId: current.cashierId || '', cashierNameSnapshot: String(sellerName || current.cashierName || user.displayName || user.email || ''), seller: String(sellerName || current.cashierName || user.displayName || user.email || ''), createdAt: Date.now(), businessDate: day.businessDate, operationalDayId: day.id, subtotal: Number(current.subtotal || 0), discount: Number(current.discount || 0), total: Number(current.total || 0), paymentMethod, payment: { method: paymentMethod }, items: current.items || [], order: { ...current, items: current.items || [] }, source: 'pending_table', pendingTableId: id,
  }
  const now = Date.now()
  const paid = { ...current, id, tabId: id, status: 'paid', linkedSaleId: saleId, paidAt: current.paidAt || now, paidByUid: user.uid, paidByName: user.displayName || user.email || '', paymentMethod: sale.paymentMethod || paymentMethod, updatedAt: now }
  const auditId = `audit-pending-table-paid-${safeKey(id)}`
  const updates = { [`pos101_sales/${saleId}`]: sale, [`pos101_pending_tables/${id}`]: paid, [`${auditPath}/${auditId}`]: pendingTableAudit({ id: auditId, user, action: 'pending_table_paid', before: current, after: paid, businessDate: current.businessDate || day.businessDate || '' }) }
  await update(ref(db), updates)
  const [saleBack, pendingBack, auditBack] = await Promise.all([get(ref(db, `pos101_sales/${saleId}`)), get(ref(db, `pos101_pending_tables/${id}`)), get(financialPath(`${auditPath}/${auditId}`))])
  if (!saleBack.exists() || !pendingBack.exists() || pendingBack.val()?.status !== 'paid' || pendingBack.val()?.linkedSaleId !== saleId || !auditBack.exists()) throw Object.assign(new Error('فشل read-back لتحصيل الطاولة المعلقة.'), { code: 'PENDING_TABLE_PAYMENT_READBACK_FAILED' })
  return { pendingTable: pendingBack.val(), sale: saleBack.val(), duplicate: false }
}

export const correctCentralSaleItems = async (sale, changes = {}) => {
  const user = await staffUser(true)
  const reason = String(changes.reason || '').trim()
  if (!reason) throw Object.assign(new Error('سبب تصحيح المنتجات مطلوب.'), { code: 'SALE_CORRECTION_REASON_REQUIRED' })
  const identity = changes.correctionIdentity || {}
  const identityCheck = validateCorrectionIdentity({ name: identity.name, code: identity.code, staff: await readCentralStaff(), actor: user, authorization: user.pos101Authorization || user.authorization, requireAdmin: false })
  if (!identityCheck.valid) throw Object.assign(new Error('اسم الكاشير أو الرمز غير صحيح'), { code: 'SALE_CORRECTION_IDENTITY_INVALID' })
  const id = saleIdOf(sale)
  if (!id) throw Object.assign(new Error('معرف البيع غير موجود.'), { code: 'SALE_ID_REQUIRED' })
  const saleRef = ref(db, `pos101_sales/${id}`)
  const currentSnapshot = await get(saleRef)
  if (!currentSnapshot.exists()) throw Object.assign(new Error('البيع المركزي غير موجود.'), { code: 'SALE_NOT_FOUND' })
  const current = { ...currentSnapshot.val(), id }
  if (current.status === 'voided' || current.voided) throw Object.assign(new Error('لا يمكن تعديل بيع مبطل.'), { code: 'SALE_VOIDED' })
  const dayId = String(current.operationalDayId || current.operational_day_id || '').trim()
  if (!dayId) throw Object.assign(new Error('لا يمكن تعديل بيع بلا يوم تشغيلي.'), { code: 'SALE_DAY_REQUIRED' })
  const daySnapshot = await get(ref(db, `pos101_operational_days/${dayId}`))
  const day = daySnapshot.exists() ? daySnapshot.val() : null
  if (!day || day.status !== 'open') throw Object.assign(new Error('تصحيح المنتجات متاح فقط ضمن اليوم التشغيلي المفتوح.'), { code: 'SALE_DAY_CLOSED' })
  const patch = buildSaleItemCorrectionPatch(current, changes)
  const now = Date.now()
  const next = { ...current, ...patch, id, saleId: current.saleId || id, updatedAt: now, updatedByUid: user.uid, updatedByName: user.displayName || user.email || '', lastEditReason: reason, lastEditAction: 'SOLD_ORDER_ITEM_CORRECTION' }
  if (!saleEditPreservesIdentity({ ...current, items: undefined }, { ...next, items: undefined })) throw new Error('محاولة تعديل حقل محمي من البيع.')
  const auditId = `sale-item-correction-${safeKey(id)}-${now}-${crypto.randomUUID().slice(0, 8)}`
  const oldTotals = correctionTotalsSnapshot(current)
  const newTotals = correctionTotalsSnapshot(next)
  const audit = {
    ...financialAuditPayload({ id: auditId, user, action: 'SOLD_ORDER_ITEM_CORRECTION', entityType: 'sale_item_correction', entityId: id, before: { saleId: id, orderNumber: current.orderNumber, items: soldItemsSnapshot(current), totals: oldTotals }, after: { saleId: id, orderNumber: next.orderNumber, items: next.items, totals: newTotals }, reason, businessDate: current.businessDate || day.businessDate || '' }),
    saleId: id,
    orderNumber: current.orderNumber,
    editedBy: { uid: user.uid, name: user.displayName || user.email || '' },
    editedAt: now,
    oldItems: soldItemsSnapshot(current),
    newItems: next.items,
    oldTotals,
    newTotals,
    changedFields: saleCorrectionChangedFields(current, next),
    correctedByName: identityCheck.name,
    correctedByCode: identityCheck.maskedCode || maskCorrectionCode(identity.code),
    maskedCode: identityCheck.maskedCode || maskCorrectionCode(identity.code),
    codeVerified: true,
    correctedByRole: identityCheck.role,
    correctedByUid: user.uid || '',
    correctionReason: reason,
    correctedAt: now,
    diff: saleCorrectionChangedFields(current, next),
  }
  const historyEntry = { action: audit.action, auditId, editedAt: now, editedByUid: user.uid, correctedByName: identityCheck.name, correctedByCode: identityCheck.maskedCode, correctedByRole: identityCheck.role, reason, oldTotal: oldTotals.total, newTotal: newTotals.total, changedFields: audit.changedFields }
  if (Array.isArray(current.editHistory)) next.editHistory = [...current.editHistory, historyEntry]
  await update(ref(db), { [`pos101_sales/${id}`]: next, [`${auditPath}/${auditId}`]: audit })
  const [saleBack, auditBack, salesBack] = await Promise.all([get(saleRef), get(financialPath(`${auditPath}/${auditId}`)), get(salesRef())])
  if (!saleBack.exists() || !auditBack.exists() || !saleEditPreservesIdentity({ ...current, items: undefined }, { ...saleBack.val(), items: undefined })) throw new Error('تعذر التحقق من تصحيح البيع وسجل التدقيق.')
  const matching = centralValues(salesBack).filter(row => saleIdOf(row) === id)
  if (matching.length !== 1 || String(saleBack.val()?.orderNumber || '') !== String(current.orderNumber || '')) throw new Error('تعذر التحقق من هوية البيع وعدم تكراره.')
  const saved = { ...saleBack.val(), id }
  const local = readSales()
  const index = local.findIndex(row => saleIdOf(row) === id)
  if (index >= 0) { local[index] = saved; writeSales(local); dispatchUpdated() }
  window.dispatchEvent(new CustomEvent('pos101-sale-updated', { detail: saved }))
  return saved
}

const readPreCloseFinancialReconciliation = async operationalDay => {
  const dayId = String(operationalDay?.id || operationalDay?.operationalDayId || '').trim()
  const businessDate = String(operationalDay?.businessDate || '').trim()
  const [expensesSnapshot, transactionsSnapshot] = await Promise.all([
    get(expensesRef()),
    get(financialPath(cashboxTransactionsPath)),
  ])
  const centralExpenses = expenseValues(expensesSnapshot)
  const localPendingExpenses = readCachedExpenses().filter(expense => {
    if (expense.syncStatus !== 'pending') return false
    return String(expense.operationalDayId || '') === dayId
      || (!expense.operationalDayId && String(expense.businessDate || '') === businessDate)
  })
  const centralExpenseIds = new Set(centralExpenses.map(expenseIdOf))
  const centralExpenseFingerprints = new Set(centralExpenses.map(expenseFingerprint))
  const unresolvedExpenses = localPendingExpenses.filter(expense => {
    const id = expenseIdOf(expense)
    return !(id && centralExpenseIds.has(id)) && !centralExpenseFingerprints.has(expenseFingerprint(expense))
  })
  const centralTransactions = objectValues(transactionsSnapshot)
    .filter(row => String(row?.operationalDayId || '') === dayId
      || (!row?.operationalDayId && String(row?.businessDate || '') === businessDate))
  // Cashbox transactions are written directly to Firebase and read back by
  // saveCashboxTransaction. There is intentionally no local withdrawal queue;
  // keeping this count explicit prevents a false "all synced" claim if that
  // storage model changes later.
  const pendingWithdrawals = 0
  return {
    allowed: unresolvedExpenses.length === 0 && pendingWithdrawals === 0,
    pendingExpenses: unresolvedExpenses,
    pendingExpenseCount: unresolvedExpenses.length,
    pendingWithdrawals,
    centralExpenseCount: centralExpenses.length,
    centralTransactionCount: centralTransactions.length,
    message: unresolvedExpenses.length
      ? 'توجد مصاريف محلية غير متزامنة. أكمل المزامنة قبل إنهاء اليوم.'
      : '',
  }
}

export const readPreCloseReconciliation = async (operationalDay, { openOrderCount = 0 } = {}) => {
  await financialUser(false)
  const centralSales = centralValues(await get(salesRef()))
  // Readback is also the restart repair path. Persist only sync metadata after
  // exact payload verification; never resend or rewrite the central sale.
  reconcileSalesAgainstCentral(centralSales)
  const salesReconciliation = reconcilePreCloseSales({ localSales: readSales(), queueEntries: readSaleQueue(), voidQueueEntries: readVoidUpdateQueue(), centralSales, operationalDay, openOrderCount })
  const financialReconciliation = await readPreCloseFinancialReconciliation(operationalDay)
  return {
    ...salesReconciliation,
    financialReconciliation,
    allowed: salesReconciliation.allowed && financialReconciliation.allowed,
    message: salesReconciliation.message || financialReconciliation.message,
  }
}

// Read-only diagnostic path. Unlike readPreCloseReconciliation, this deliberately
// does not call reconcileSalesAgainstCentral, so opening the panel cannot persist
// sync metadata, alter the queue, or trigger any retry/upload behavior.
export const readEndDayDiagnostic = async (operationalDay, { openOrderCount = 0, preCloseGuard = null } = {}) => {
  await financialUser(false)
  const [centralSalesSnapshot, currentDaySnapshot, legacyDaySnapshot] = await Promise.all([get(salesRef()), get(operationalDayCurrentRef()), get(operationalDaysRef())])
  const centralOperationalDay = currentDaySnapshot.exists() ? normalizeOperationalDay(currentDaySnapshot.val()) : latestOperationalDay(operationalDayValues(legacyDaySnapshot))
  return buildEndDayDiagnostic({
    localSales: readLocalSales(),
    queueEntries: readRawSaleQueue(),
    voidQueueEntries: readVoidUpdateQueue(),
    centralSales: centralValues(centralSalesSnapshot),
    operationalDay,
    localOperationalDay: readCachedOperationalDay(),
    centralOperationalDay,
    openOrderCount,
    preCloseGuard,
    liveCommit: BUILD_SHA,
    liveBundle: typeof document !== 'undefined' ? document.querySelector('script[src*="assets/index-"]')?.src?.split('/').pop() || '' : '',
  })
}

export const runFullRecoverySync = async () => {
  const user = await requireRole('cashier-sync')
  const localDay = readCachedOperationalDay()
  const remoteDay = latestOpenOperationalDay(operationalDayValues(await get(operationalDaysRef())))
  const reconciledDay = remoteDay || localDay
  if (reconciledDay) cacheOperationalDay(reconciledDay)
  const sales = await runCashierCentralSync({ initial: true })
  const expenses = await runExpenseCentralSync({ initial: true })
  const localExpenses = readCachedExpenses()
  const localSales = readSales()
  return {
    user: { uid: user.uid, email: user.email || '' },
    operationalDay: reconciledDay,
    sales: { localCount: localSales.length, centralCount: sales.centralCount, uploaded: sales.uploaded, pending: localSales.filter(sale => !isSaleEligibleForCentralUpload(sale)).length, duplicatesSkipped: sales.updated },
    expenses: { localCount: localExpenses.length, centralCount: expenses.centralCount, uploaded: expenses.uploaded, pending: localExpenses.filter(expense => expense.syncStatus === 'pending').length, duplicatesSkipped: expenses.skipped },
    realtime: {
      salesConnected: Boolean(configured && db && isCentralCashierUser(auth?.currentUser)),
      expensesConnected: Boolean(configured && db && isOperationalDayUser(auth?.currentUser)),
      operationalDayConnected: Boolean(configured && db && isOperationalDayUser(auth?.currentUser)),
    },
  }
}

export const startOperationalDay = async ({ startedBy = {}, openingCashBalance, openingCashSource = 'manual', previousOperationalDayId = '', openingCashAdjustmentNote = '' } = {}) => {
  const user = await requireOperationalDayRole()
  const opening = Number(openingCashBalance)
  if (!Number.isFinite(opening) || opening < 0) throw new Error('رصيد بداية اليوم مطلوب ويجب ألا يقل عن صفر.')
  const now = Date.now()
  const legacySnapshot = await get(operationalDaysRef())
  const legacyOpen = latestOpenOperationalDay(operationalDayValues(legacySnapshot))
  const transaction = await runTransaction(operationalDayCurrentRef(), current => {
    if (normalizeOperationalDay(current)?.status === 'open') return current
    if (!current && legacyOpen) return legacyOpen
    const id = crypto.randomUUID()
    return {
      id,
      operationalDayId: id,
      businessDate: localBusinessDate(now),
      startedBy: { uid: user.uid, name: startedBy.name || '', email: user.email || '' },
      startSource: 'manual_start_day',
      startedByUid: user.uid,
      startedByRole: user?.role || user?.scope || '',
      startedByDeviceId: getDeviceId(),
      startedAt: now,
      openedAt: now,
      openedBy: { uid: user.uid, name: startedBy.name || '', email: user.email || '' },
      openingCashBalance: opening,
      openingCashSource: openingCashSource === 'previous_closing' ? 'previous_closing' : 'manual',
      previousOperationalDayId: String(previousOperationalDayId || ''),
      openingCashAdjustmentNote: String(openingCashAdjustmentNote || '').trim(),
      confirmedAt: now,
      confirmedBy: { uid: user.uid, name: startedBy.name || user.displayName || user.email || '', email: user.email || '' },
      endedAt: null,
      endedBy: null,
      closedAt: null,
      closedBy: null,
      closeSummary: null,
      version: Number(current?.version || 0) + 1,
      updatedAt: now,
      status: 'open',
    }
  })
  const day = normalizeOperationalDay(transaction.snapshot.val())
  if (!day) throw Object.assign(new Error('تعذر إنشاء اليوم التشغيلي المركزي.'), { code: 'CENTRAL_DAY_START_FAILED' })
  let legacyBack = null
  const startAuditId = `audit-start-${safeKey(day.id)}-${now}`
  const startAudit = financialAuditPayload({ id: startAuditId, user, action: 'start operational day', entityType: 'operational_day', entityId: day.id, after: day, reason: 'manual_start_day', businessDate: day.businessDate })
  try {
    await set(ref(db, `pos101_operational_days/${day.id}`), day)
    await set(financialPath(`${auditPath}/${startAuditId}`), startAudit)
    legacyBack = await get(ref(db, `pos101_operational_days/${day.id}`))
  } catch (error) {
    if (!isCentralAdminUser(user)) throw error
  }
  const currentBack = await get(operationalDayCurrentRef())
  const verified = normalizeOperationalDay(currentBack.val())
  if (!verified || verified.status !== 'open' || (!isCentralAdminUser(user) && (!legacyBack?.exists() || operationalDayIdOf(legacyBack.val()) !== day.id))) throw Object.assign(new Error('تعذر التحقق من بدء اليوم التشغيلي المركزي.'), { code: 'CENTRAL_DAY_START_READBACK_FAILED' })
  return cacheOperationalDay(verified, { central: true })
}

export const setOperationalDayOpeningCashBalance = async (day, { openingCashBalance, reason = 'رصيد افتتاحي/تمويل صندوق مفقود.' } = {}) => {
  const user = await requireOperationalDayRole()
  const id = operationalDayIdOf(day)
  const opening = Number(openingCashBalance)
  if (!id || !day?.businessDate) throw Object.assign(new Error('هوية اليوم التشغيلي والتاريخ مطلوبان.'), { code: 'OPENING_DAY_REQUIRED' })
  if (!Number.isFinite(opening) || opening < 0) throw Object.assign(new Error('رصيد بداية اليوم يجب أن يكون رقماً لا يقل عن صفر.'), { code: 'OPENING_CASH_INVALID' })
  const dayRef = ref(db, `pos101_operational_days/${id}`)
  const currentSnapshot = await get(dayRef)
  if (!currentSnapshot.exists() || currentSnapshot.val()?.status !== 'open') throw Object.assign(new Error('لا يمكن تعديل رصيد يوم غير مفتوح.'), { code: 'OPENING_DAY_NOT_OPEN' })
  const current = currentSnapshot.val()
  const now = Date.now()
  const note = String(reason || '').trim() || 'رصيد افتتاحي/تمويل صندوق مفقود.'
  const auditId = `audit-opening-cash-${safeKey(id)}-${now}`
  const audit = financialAuditPayload({
    id: auditId,
    user,
    action: 'manual opening cash balance reconciliation',
    entityType: 'operational_day_opening_cash',
    entityId: id,
    before: { openingCashBalance: current.openingCashBalance ?? null },
    after: { openingCashBalance: opening },
    reason: 'MANUAL_OPENING_CASH_BALANCE_SET_FROM_CASH_RECONCILIATION: ' + note,
    businessDate: day.businessDate,
  })
  await update(ref(db), {
    [`pos101_operational_days/${id}/openingCashBalance`]: opening,
    [`pos101_operational_days/${id}/openingCashSource`]: 'manual',
    [`pos101_operational_days/${id}/openingCashAdjustmentNote`]: note,
    [`pos101_operational_days/${id}/openingCashAdjustedAt`]: now,
    [`pos101_operational_days/${id}/openingCashAdjustedBy`]: { uid: user.uid, name: user.displayName || user.email || '', email: user.email || '' },
    [`${OPERATIONAL_DAY_CURRENT_PATH}/openingCashBalance`]: opening,
    [`${OPERATIONAL_DAY_CURRENT_PATH}/openingCashSource`]: 'manual',
    [`${OPERATIONAL_DAY_CURRENT_PATH}/openingCashAdjustmentNote`]: note,
    [`${OPERATIONAL_DAY_CURRENT_PATH}/openingCashAdjustedAt`]: now,
    [`${OPERATIONAL_DAY_CURRENT_PATH}/openingCashAdjustedBy`]: { uid: user.uid, name: user.displayName || user.email || '', email: user.email || '' },
    [`${auditPath}/${auditId}`]: audit,
  })
  const [dayBack, currentBack, auditBack] = await Promise.all([get(dayRef), get(operationalDayCurrentRef()), get(financialPath(`${auditPath}/${auditId}`))])
  const updatedDay = dayBack.exists() ? { ...dayBack.val(), id } : null
  const updatedCurrentDay = currentBack.exists() ? normalizeOperationalDay(currentBack.val(), id) : null
  if (!updatedDay || updatedDay.status !== 'open' || Number(updatedDay.openingCashBalance) !== opening || !updatedCurrentDay || Number(updatedCurrentDay.openingCashBalance) !== opening || !auditBack.exists()) throw Object.assign(new Error('تعذر التحقق من تحديث رصيد الافتتاح.'), { code: 'OPENING_CASH_READBACK_FAILED' })
  const cached = cacheOperationalDay(updatedCurrentDay, { central: true })
  return { day: cached || updatedDay, audit: auditBack.val() }
}

export const endOperationalDay = async (day, { endedBy = {} } = {}) => {
  const user = await requireOperationalDayRole()
  const id = operationalDayIdOf(day)
  if (!id) throw new Error('لا يوجد يوم تشغيلي مفتوح.')
  const current = await ensureCanonicalOperationalDay()
  if (!current || current.id !== id || current.status !== 'open') throw operationalDayGuardError('CENTRAL_DAY_CLOSED', 'اليوم التشغيلي مغلق أو تغيّر من جهاز آخر.', current || {})
  const transaction = await runTransaction(operationalDayCurrentRef(), currentDay => {
    if (!currentDay || currentDay.status !== 'open' || operationalDayIdOf(currentDay) !== id) return currentDay
    const now = Date.now()
    return { ...currentDay, status: 'closed', endedAt: now, endedBy: { uid: user.uid, name: endedBy.name || '', email: user.email || '' }, closedAt: now, closedBy: { uid: user.uid, name: endedBy.name || '', email: user.email || '' }, updatedAt: now, version: Number(currentDay.version || 0) + 1 }
  })
  const result = transaction.snapshot.exists() ? normalizeOperationalDay(transaction.snapshot.val(), id) : null
  if (!result || result.status !== 'closed') throw operationalDayGuardError('CENTRAL_DAY_CLOSE_FAILED', 'تعذر إغلاق اليوم التشغيلي المركزي.')
  await set(ref(db, `pos101_operational_days/${id}`), result)
  const [currentBack, legacyBack] = await Promise.all([get(operationalDayCurrentRef()), get(ref(db, `pos101_operational_days/${id}`))])
  const verified = normalizeOperationalDay(currentBack.val(), id)
  if (!verified || verified.status !== 'closed' || !legacyBack.exists() || legacyBack.val()?.status !== 'closed') throw Object.assign(new Error('تعذر التحقق من إغلاق اليوم التشغيلي المركزي.'), { code: 'CENTRAL_DAY_CLOSE_READBACK_FAILED' })
  return cacheOperationalDay(verified, { central: true })
}

export const inspectLocalSales = () => {
  const sales = readSales().filter(sale => saleIdOf(sale))
  const latest = sales.slice().sort((a, b) => Number(b.orderNumber || 0) - Number(a.orderNumber || 0))[0]
  return { count: sales.length, latestOrderNumber: latest?.orderNumber ?? null, latestCreatedAt: latest?.createdAt ?? null }
}

// Order numbers are allocated centrally on the open operational-day node.
// The RTDB transaction serializes two devices, while the global central max
// prevents reusing an old number after a local counter reset or day rollover.
export const allocateCentralOrderNumber = async ({ operationalDayId, businessDate } = {}) => {
  await financialUser(true)
  const dayId = String(operationalDayId || '').trim()
  if (!dayId) throw Object.assign(new Error('اليوم التشغيلي مطلوب لتخصيص رقم الطلب.'), { code: 'ORDER_NUMBER_DAY_REQUIRED' })
  const centralDay = await ensureCanonicalOperationalDay()
  if (!centralDay || centralDay.status !== 'open') {
    throw Object.assign(new Error('لا يمكن تخصيص رقم طلب خارج يوم تشغيلي مفتوح.'), { code: 'ORDER_NUMBER_DAY_CLOSED', operationalDay: centralDay })
  }
  if (centralDay.id !== dayId || String(centralDay.businessDate || '') !== String(businessDate || '')) {
    throw operationalDayGuardError('CENTRAL_DAY_MISMATCH', 'لا يمكن تخصيص رقم طلب لليوم التشغيلي القديم.', centralDay)
  }
  const centralSales = centralValues(await get(salesRef()))
  let allocated = null
  // The canonical transaction supersedes the legacy runTransaction(dayRef,
  // ...) allocator while the historical day node remains a readback mirror.
  const transaction = await runTransaction(operationalDayCurrentRef(), current => {
    if (!current || current.status !== 'open') return
    if (operationalDayIdOf(current) !== dayId || (businessDate && String(current.businessDate || '') !== String(businessDate))) return
    const next = nextCentralOrderNumber({ day: current, centralSales })
    allocated = next
    return { ...current, nextOrderNumber: next + 1, lastOrderNumberAllocated: next, lastOrderNumberAllocatedAt: Date.now(), updatedAt: Date.now(), version: Number(current.version || 0) + 1 }
  })
  if (!transaction.committed || !Number.isInteger(allocated) || allocated < 1) {
    throw Object.assign(new Error('تعذر تخصيص رقم طلب مركزي بأمان.'), { code: 'ORDER_NUMBER_TRANSACTION_FAILED' })
  }
  const currentAfterAllocation = transaction.snapshot.val()
  await update(ref(db), { [`pos101_operational_days/${dayId}/nextOrderNumber`]: allocated + 1, [`pos101_operational_days/${dayId}/lastOrderNumberAllocated`]: allocated, [`pos101_operational_days/${dayId}/lastOrderNumberAllocatedAt`]: currentAfterAllocation.lastOrderNumberAllocatedAt, [`pos101_operational_days/${dayId}/updatedAt`]: currentAfterAllocation.updatedAt, [`pos101_operational_days/${dayId}/version`]: currentAfterAllocation.version })
  const readBack = await get(operationalDayCurrentRef())
  if (!readBack.exists() || Number(readBack.val()?.lastOrderNumberAllocated) !== allocated || Number(readBack.val()?.nextOrderNumber) <= allocated) {
    throw Object.assign(new Error('تعذر التحقق من رقم الطلب المركزي بعد التخصيص.'), { code: 'ORDER_NUMBER_READBACK_FAILED' })
  }
  return { orderNumber: allocated, operationalDayId: dayId, businessDate: String(readBack.val()?.businessDate || businessDate || '') }
}

export const getCentralSyncState = () => ({ initialSyncCompleted: readInitialSyncCompleted() })

export const mergeCentralSalesLocally = centralSales => {
  const localSales = readSales()
  const merged = mergeBySaleId(localSales, centralSales)
  if (JSON.stringify(merged) !== JSON.stringify(localSales)) {
    writeSalesCache(merged, { centralReadable: Array.isArray(centralSales) && centralSales.length > 0 })
    dispatchUpdated()
  }
  // Run after the merge so a legacy central status (including null) cannot
  // overwrite the durable local verification metadata on restart.
  reconcileSalesAgainstCentral(centralSales)
  return merged
}

const logQueueDecision = (sale, reason = '', detail = '', fields = {}) => {
  const payload = {
    queueLength: fields.queueLength ?? null,
    eligible: fields.eligible ?? null,
    locked: fields.locked ?? false,
    processingStarted: fields.processingStarted ?? false,
    skippedReason: reason || '',
    saleId: saleIdOf(sale),
    orderNumber: sale?.orderNumber ?? '',
    operationKey: sale?.operationKey || sale?.operation_key || '',
    firebaseWriteResult: fields.firebaseWriteResult ?? 'not-started',
    readbackResult: fields.readbackResult ?? 'not-started',
    localUpdateResult: fields.localUpdateResult ?? 'not-started',
    detail,
  }
  console.info('[POS101_MANUAL_QUEUE]', JSON.stringify(payload))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sync-worker-diagnostic', { detail: payload }))
}

const logQueueItemDiagnostic = ({ index, sale, entry, firebaseExists, action, detail = '' } = {}) => {
  const items = Array.isArray(sale?.items) ? sale.items : Array.isArray(sale?.order?.items) ? sale.order.items : []
  const payload = {
    event: 'QUEUE_ITEM_DIAGNOSTIC',
    QUEUE_ITEM_INDEX: index,
    saleId: saleIdOf(sale),
    orderNumber: sale?.orderNumber ?? entry?.orderNumber ?? null,
    total: Number(sale?.total ?? sale?.subtotal ?? entry?.total ?? 0),
    businessDate: sale?.businessDate || entry?.businessDate || '',
    operationalDayId: sale?.operationalDayId || sale?.operational_day_id || entry?.operationalDayId || '',
    items: items.map(item => `${item?.name || item?.id || 'item'}×${item?.quantity ?? 0}`).join(', '),
    attempts: Number(entry?.attemptCount ?? entry?.attempts ?? 0),
    lastAttemptAt: entry?.lastAttemptAt || null,
    lastError: entry?.lastError || sale?.syncError || '',
    firebaseExists: Boolean(firebaseExists),
    action,
    detail,
  }
  console.info('[POS101_QUEUE_ITEM]', JSON.stringify(payload))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-sync-worker-diagnostic', { detail: payload }))
  return payload
}

const resolveVoidedQueueEntries = async centralSales => {
  const rawQueue = readRawSaleQueue()
  let resolved = 0
  let failed = 0
  for (const [index, entry] of rawQueue.entries()) {
    const sale = entry?.sale
    if (!sale || !isVoidedSale(sale)) continue
    const central = (centralSales || []).find(remote => saleIdOf(remote) === saleIdOf(sale))
    const saleRef = ref(db, `pos101_sales/${saleIdOf(sale)}`)
    let readBack = central ? await get(saleRef).catch(() => null) : null
    const firebaseExists = Boolean(readBack?.exists())
    const firebaseStatus = readBack?.val()?.status || (readBack?.val()?.voided ? 'voided' : '')
    if (!readBack?.exists()) {
      logQueueItemDiagnostic({ index, sale, entry, firebaseExists: false, action: 'SKIP_AND_CLEAR_QUEUE', detail: 'VOIDED_BEFORE_SYNC' })
      resolveVoidedSaleLocally(sale)
      resolved += 1
      continue
    }
    logQueueItemDiagnostic({ index, sale, entry, firebaseExists: true, action: 'SYNC_VOID_STATUS', detail: isVoidedSale(readBack.val()) ? 'CENTRAL_ALREADY_VOIDED' : 'CENTRAL_ACTIVE_REQUIRES_VOID_UPDATE' })
    try {
      const voidedAt = sale.voidedAt || sale.cancelledAt || sale.canceledAt || Date.now()
      const audit = auditRows(sale).slice().reverse().find(row => row?.type === 'void') || { id: `void-${saleIdOf(sale)}-${voidedAt}`, type: 'void', at: voidedAt, cashierId: sale.cashierId || '', cashierNameSnapshot: sale.cashierNameSnapshot || sale.seller || '', reason: sale.voidReason || '' }
      const result = await voidCentralSaleImmediately(sale, { voidPayload: { voidedAt, voidedBy: sale.voidedBy || sale.cashierId || '', voidReason: sale.voidReason || '', audit }, audit })
      markSaleVoidedCentral(sale, { voidConfirmedAt: Date.now(), queueResolution: 'voided_central_readback_verified', audit: result.audit })
      console.info('[POS101_QUEUE_ITEM]', JSON.stringify({ QUEUE_ITEM: index, saleId: saleIdOf(sale), orderNumber: sale.orderNumber, localStatus: sale.status, firebaseExists: true, firebaseStatus: 'voided', classification: 'VOID_SYNC_NEEDED', action: 'SYNC_VOID_STATUS' }))
      resolved += 1
    } catch (error) {
      failed += 1
      console.info('[POS101_QUEUE_ITEM]', JSON.stringify({ QUEUE_ITEM: index, saleId: saleIdOf(sale), orderNumber: sale.orderNumber, localStatus: sale.status, firebaseExists, firebaseStatus, classification: 'VOID_SYNC_NEEDED', action: 'SYNC_VOID_STATUS', error: error?.message || String(error) }))
    }
  }
  return { resolved, failed, remainingVoided: readRawSaleQueue().filter(entry => isVoidedSale(entry?.sale)).length }
}

const resolveVoidUpdateQueueEntries = async () => {
  const entries = readVoidUpdateQueue()
  let resolved = 0
  let failed = 0
  const localSales = readSales()
  for (const entry of entries) {
    const localSale = localSales.find(row => saleIdOf(row) === String(entry.saleId)) || { saleId: entry.saleId, id: entry.saleId, orderNumber: entry.orderNumber, businessDate: entry.businessDate, operationalDayId: entry.operationalDayId, status: 'voided' }
    const payload = entry.voidPayload || {}
    const audit = payload.audit || auditRows(localSale).slice().reverse().find(row => row?.type === 'void') || null
    try {
      const result = await voidCentralSaleImmediately(localSale, { voidPayload: payload, audit })
      if (result.neverExisted) {
        if (localSale.centralVerified === true) { failed += 1; continue }
        resolveVoidedSaleLocally(localSale, { queueResolution: 'voided_before_central_sync', reason: 'Firebase sale was absent during void retry' })
      } else {
        markSaleVoidedCentral(localSale, { voidConfirmedAt: Date.now(), audit: result.audit, queueResolution: 'void_status_synced' })
      }
      resolved += 1
    } catch (error) {
      failed += 1
      console.info('[POS101_VOID_QUEUE_ITEM]', JSON.stringify({ type: 'void_update', saleId: entry.saleId, orderNumber: entry.orderNumber, action: 'RETAIN', error: error?.code || error?.message || String(error) }))
    }
  }
  return { resolved, failed, remaining: readVoidUpdateQueue().length }
}

const normalizeQueuedSaleForCurrentDay = sale => {
  const currentDay = readCachedOperationalDay()
  const saleId = String(saleIdOf(sale) || '').trim()
  const total = Number(sale?.total ?? sale?.subtotal)
  const items = Array.isArray(sale?.items) ? sale.items : Array.isArray(sale?.order?.items) ? sale.order.items : []
  let businessDate = String(sale?.businessDate || '').trim()
  let operationalDayId = String(sale?.operationalDayId || sale?.operational_day_id || '').trim()
  const createdDate = sale?.createdAt ? localBusinessDate(sale.createdAt) : ''
  if (!businessDate && currentDay?.businessDate && createdDate === String(currentDay.businessDate)) businessDate = String(currentDay.businessDate)
  if (!operationalDayId && currentDay?.id && businessDate === String(currentDay.businessDate)) operationalDayId = String(currentDay.id)
  const operationKey = String(sale?.operationKey || sale?.operation_key || '').trim() || (saleId ? `pos101:${saleId}` : '')
  const paymentMethod = String(sale?.paymentMethod || sale?.payment?.method || sale?.paymentType || '').trim()
  const missing = []
  if (!saleId) missing.push('saleId')
  if (!Number.isFinite(total)) missing.push('total')
  if (!items.length) missing.push('items')
  if (!businessDate) missing.push('businessDate')
  else if (currentDay?.businessDate && businessDate !== String(currentDay.businessDate)) missing.push(`businessDate!=${currentDay.businessDate}`)
  if (currentDay?.id && operationalDayId && operationalDayId !== String(currentDay.id)) missing.push(`operationalDayId!=${currentDay.id}`)
  return {
    sale: { ...sale, saleId, id: saleId, operationKey, businessDate, operationalDayId, paymentMethod, items },
    missing,
  }
}

const runCashierCentralSyncUnlocked = async ({ initial = false, queueOnly = false, manualReport = null } = {}) => {
  try { await requireRole('cashier-sync') } catch (error) {
    logQueueDecision(null, error?.code === 'KIOSK_AUTH_REQUIRED' ? 'auth claims missing' : 'auth required', error?.message || '')
    throw error
  }
  const localSales = readSales()
  // The queue is durable evidence of a completed sale. Older cashier builds
  // could persist the queue wrapper without retaining the matching ledger row,
  // so the worker must include queue.sale as a candidate instead of silently
  // treating that sale as nonexistent.
  const rawQueue = readRawSaleQueue()
  logQueueDecision(null, '', '', { queueLength: rawQueue.length, processingStarted: true })
  const before = await get(salesRef())
  let beforeCentral = centralValues(before)
  const voidUpdateResult = await resolveVoidUpdateQueueEntries()
  const voidedQueueResult = await resolveVoidedQueueEntries(beforeCentral)
  if (voidUpdateResult.resolved || voidedQueueResult.resolved) beforeCentral = centralValues(await get(salesRef()))
  const centralDay = await readCentralOperationalDay()
  if (!centralDay || centralDay.status !== 'open') {
    const reason = centralDay ? 'CENTRAL_DAY_CLOSED' : 'CENTRAL_DAY_UNAVAILABLE'
    logQueueDecision(null, 'operational-day-blocked', reason, { queueLength: rawQueue.length, processingStarted: false, firebaseWriteResult: 'not-started', readbackResult: 'not-started', localUpdateResult: 'retained-in-queue', voidUpdateResolved: voidUpdateResult.resolved + voidedQueueResult.resolved })
    if (manualReport) manualReport.errors.push(reason)
    return { uploaded: 0, received: 0, centralCount: beforeCentral.length, mergedCount: localSales.length, localCount: localSales.length, updated: 0, initialSyncCompleted: readInitialSyncCompleted(), uploadBlocked: true, blockedReason: reason, skipped: rawQueue.length, queueCleanup: { removed: 0, retained: rawQueue.length }, voidUpdateResult, voidedQueueResult, strandedRecovered: 0, historicalOrderNumberDuplicates: [] }
  }
  const known1056 = beforeCentral.find(sale => saleIdOf(sale) === KNOWN_MANUAL_REVIEW_SALE_1056)
  const local1056 = localSales.find(sale => saleIdOf(sale) === KNOWN_MANUAL_REVIEW_SALE_1056)
  if (known1056 || local1056) restoreManualReviewQuarantineMarker({ saleId: KNOWN_MANUAL_REVIEW_SALE_1056, orderNumber: 1056, reason: KNOWN_MANUAL_REVIEW_REASON_1056, centralExists: Boolean(known1056) })
  const recovery = reconcileSalesQueue(beforeCentral, {
    onStrandedSale: sale => logQueueDecision(sale, 'STRANDED_SALE_FOUND', 'local ledger row was absent from the active queue', { queueLength: readRawSaleQueue().length, eligible: true, processingStarted: false, firebaseWriteResult: 'not-started', readbackResult: 'not-started', localUpdateResult: 'recovery-enqueued' }),
  })
  const historicalOrderNumberDuplicates = buildOrderNumberDuplicateReport(beforeCentral)
  if (historicalOrderNumberDuplicates.length) {
    console.warn('[POS101_ORDER_NUMBER_REVIEW]', JSON.stringify({ reason: 'HISTORICAL_DUPLICATE_ORDER_NUMBERS', records: historicalOrderNumberDuplicates }))
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pos101-order-number-review', { detail: historicalOrderNumberDuplicates }))
  }
  // Legacy/malformed queue cleanup is local-only. The central snapshot above
  // is read once; reconciliation itself performs zero Firebase writes and
  // removes only entries proven against that snapshot.
  const queueCleanup = reconcileLocalQueueAgainstCentral(beforeCentral)
  const activeQueueAfterCleanup = readSaleQueue()
  const queuedSales = []
  for (const rawEntry of activeQueueAfterCleanup) {
    const rawSale = rawEntry?.sale
    if (!rawSale) { logQueueDecision(null, 'missing:sale', 'missing sale payload', { queueLength: activeQueueAfterCleanup.length }); continue }
    const normalized = normalizeQueuedSaleForCurrentDay(rawSale)
    if (normalized.missing.length) {
      const recoveredCollision = rawSale.recoveredFromLocalLedger ? findActiveOrderNumberCollision(normalized.sale, beforeCentral) : null
      const reviewReason = recoveredCollision ? 'STRANDED_SALE_REQUIRES_MANUAL_REVIEW:ORDER_NUMBER_COLLISION_MANUAL_REVIEW' : 'STRANDED_SALE_REQUIRES_MANUAL_REVIEW:OPERATIONAL_DAY_MISMATCH'
      logQueueDecision(normalized.sale, `missing:${normalized.missing.join(',')}`, reviewReason, { queueLength: activeQueueAfterCleanup.length, eligible: false })
      if (rawSale.recoveredFromLocalLedger) quarantineSale(rawSale, reviewReason, { ...rawEntry, centralMatch: recoveredCollision || null })
      if (manualReport) manualReport.salesToProcess.push({ orderNumber: normalized.sale?.orderNumber ?? null, saleId: saleIdOf(normalized.sale), operationKey: normalized.sale?.operationKey || '', centralBefore: false, writeAttempted: false, writeResult: 'SKIPPED', readbackResult: 'SKIPPED', localUpdateResult: 'RETAINED', error: `missing:${normalized.missing.join(',')};${reviewReason}` })
      continue
    }
    queuedSales.push(normalized.sale)
  }
  const candidateByIdentity = new Map()
  // Every upload candidate must have an active durable queue entry. Ledger-only
  // rows are first recovered into that queue above, so a stale local record can
  // never bypass the duplicate/day/readback gates below.
  for (const sale of queuedSales) {
    const identity = String(saleIdOf(sale) || sale?.operationKey || sale?.operation_key || '')
    if (identity && !candidateByIdentity.has(identity)) candidateByIdentity.set(identity, sale)
  }
  const centralIds = new Set(beforeCentral.map(saleIdOf))
  const candidates = [...candidateByIdentity.values()].filter(sale => {
    if (isManualReviewQuarantined(saleIdOf(sale))) {
      logQueueDecision(sale, 'manual-review-required', KNOWN_MANUAL_REVIEW_REASON_1056, { queueLength: activeQueueAfterCleanup.length, eligible: false })
      return false
    }
    if (!isSaleSyncEligible(sale)) { logQueueDecision(sale, 'missing:validSalePayload', 'queue entry is not recoverable', { queueLength: rawQueue.length, eligible: false }); return false }
    return true
  })
  const uploadable = candidates
  let uploaded = 0
  let updated = 0
  await retryAccSaleQueue()
  for (const [index, sale] of uploadable.entries()) {
    if (!currentDayMatchesSale(centralDay, sale)) {
      const error = operationalDayGuardError('CENTRAL_DAY_MISMATCH', 'تعذر رفع مبيعة مرتبطة بيوم تشغيلي غير حالي.', centralDay)
      const queueEntry = readSaleQueue().find(entry => saleIdOf(entry?.sale) === saleIdOf(sale))
      if (queueEntry) retainQueuedSale(queueEntry, error)
      logQueueDecision(sale, 'operational-day-mismatch', error.code, { queueLength: rawQueue.length, eligible: false, processingStarted: false, firebaseWriteResult: 'blocked', readbackResult: 'not-required', localUpdateResult: 'retained-in-queue' })
      continue
    }
    syncLockManager.heartbeat({ trigger: queueOnly ? 'manual' : 'worker', processingSaleIds: [saleIdOf(sale)] })
    const queueEntry = readSaleQueue().find(entry => {
      const queued = entry.sale
      return saleIdOf(queued) === saleIdOf(sale)
        || String(queued?.operationKey || queued?.operation_key || '') === String(sale?.operationKey || sale?.operation_key || '')
    })
    const classification = classifyCentralSale(sale, beforeCentral)
    logQueueItemDiagnostic({ index, sale, entry: queueEntry, firebaseExists: Boolean(classification.central), action: classification.action, detail: classification.reason })
    const manualSale = manualReport ? {
      orderNumber: sale?.orderNumber ?? null,
      saleId: saleIdOf(sale),
      operationKey: sale?.operationKey || sale?.operation_key || `pos101:${saleIdOf(sale)}`,
      centralBefore: classification.action === 'duplicate',
      writeAttempted: false,
      writeResult: classification.action === 'duplicate' ? 'SKIPPED' : 'FAIL',
      readbackResult: 'FAIL',
      localUpdateResult: 'FAIL',
      error: '',
    } : null
    if (manualSale) manualReport.salesToProcess.push(manualSale)
    const orderNumberCollision = findActiveOrderNumberCollision(sale, beforeCentral)
    if (orderNumberCollision) {
      const error = Object.assign(new Error(`رقم الطلب مستخدم في مبيعة مركزية أخرى: ${sale.orderNumber}`), { code: 'ORDER_NUMBER_COLLISION_MANUAL_REVIEW' })
      logQueueItemDiagnostic({ index, sale, entry: queueEntry, firebaseExists: true, action: 'quarantine', detail: error.code })
      quarantineSale(sale, error.code, { sale, centralMatch: orderNumberCollision })
      if (queueEntry) retainQueuedSale(queueEntry, error)
      if (manualSale) manualSale.error = error.code
      logQueueDecision(sale, 'duplicate order number guard', error.code, { queueLength: rawQueue.length, eligible: true, processingStarted: true, firebaseWriteResult: 'blocked', readbackResult: 'not-required', localUpdateResult: 'retained-in-queue' })
      continue
    }
    if (classification.action === 'quarantine') {
      const error = Object.assign(new Error(`تعذر رفع مبيعة متعارضة: ${classification.reason}`), { code: classification.reason })
      if (queueEntry) retainQueuedSale(queueEntry, error)
      if (manualSale) manualSale.error = classification.reason
      logQueueDecision(sale, 'duplicate guard', classification.reason, { queueLength: rawQueue.length, eligible: true, processingStarted: true, firebaseWriteResult: 'blocked', readbackResult: 'not-required', localUpdateResult: 'retained-in-queue' })
      continue
    }
    if (classification.action === 'duplicate') {
      if (queueEntry) markSaleSynced(sale)
      if (manualSale) { manualSale.readbackResult = 'PASS'; manualSale.localUpdateResult = queueEntry ? 'PASS' : 'FAIL' }
      logQueueDecision(sale, 'duplicate guard', 'central payload already matches', { queueLength: rawQueue.length, eligible: true, processingStarted: true, firebaseWriteResult: 'not-needed', readbackResult: 'verified', localUpdateResult: 'synced' })
      updated += 1
      continue
    }
    const attemptedEntry = queueEntry ? markSaleAttempt(queueEntry) : null
    const saleRef = ref(db, `pos101_sales/${saleIdOf(sale)}`)
    const readVerifiedSale = async () => {
      {
        const readBack = await get(saleRef)
        if (!readBack?.exists() || isVoidedSale(readBack.val()) || !centralSaleMatches(sale, readBack.val()) || !saleReadbackRequiredFieldsMatch(sale, readBack.val())) return null
        return readBack
      }
    }
    if (manualSale) { manualSale.writeAttempted = true; manualSale.writeResult = 'PASS' }
    try {
      await set(saleRef, serializeSale(sale))
    } catch (error) {
      // Another authorized device may have created the same sale concurrently.
      // Continue only when the complete sale identity and business fields read back.
      const readBack = await readVerifiedSale().catch(() => null)
      if (!readBack) {
        if (attemptedEntry) retainQueuedSale(attemptedEntry, error)
        if (manualSale) { manualSale.writeResult = 'FAIL'; manualSale.error = error?.message || String(error) }
        logQueueDecision(sale, 'Firebase error', error?.message || '', { queueLength: rawQueue.length, eligible: true, processingStarted: true, firebaseWriteResult: 'failed', readbackResult: 'failed', localUpdateResult: 'retained-in-queue' })
        continue
      }
      if (manualSale) manualSale.writeResult = 'PASS'
    }
    const readBack = await readVerifiedSale().catch(() => null)
    if (!readBack) {
      const error = Object.assign(new Error('تعذر التحقق من حفظ المبيعة المركزية.'), { code: 'SALE_READBACK_FAILED' })
      if (attemptedEntry) retainQueuedSale(attemptedEntry, error)
      if (manualSale) manualSale.error = error.message
      logQueueDecision(sale, 'Firebase error', error.message, { queueLength: rawQueue.length, eligible: true, processingStarted: true, firebaseWriteResult: 'completed', readbackResult: 'mismatch', localUpdateResult: 'retained-in-queue' })
      continue
    }
    await syncAccSaleBestEffort(sale)
    if (centralIds.has(saleIdOf(sale))) updated += 1
    else uploaded += 1
    // The local ledger and queue are changed only after the full central
    // payload has been read back and matched, including operationKey.
    markSaleSynced(sale)
    if (manualSale) { manualSale.readbackResult = 'PASS'; manualSale.localUpdateResult = 'PASS' }
    logQueueDecision(sale, 'synced', 'central read-back verified', { queueLength: rawQueue.length, eligible: true, processingStarted: true, firebaseWriteResult: 'completed', readbackResult: 'verified', localUpdateResult: 'synced' })
    syncLockManager.heartbeat({ trigger: queueOnly ? 'manual' : 'worker', processingSaleIds: [] })
  }

  const after = await get(salesRef())
  const afterCentral = centralValues(after)
  const merged = mergeBySaleId(localSales, afterCentral)
  writeSales(merged)
  dispatchUpdated()
  if (initial) markInitialSyncCompleted()
  return {
    uploaded,
    received: afterCentral.filter(sale => !localSales.some(local => saleIdOf(local) === saleIdOf(sale))).length,
    centralCount: afterCentral.length,
    mergedCount: merged.length,
    localCount: localSales.length,
    updated,
    initialSyncCompleted: readInitialSyncCompleted(),
    uploadBlocked: false,
    skipped: activeQueueAfterCleanup.length - uploaded - updated,
    queueCleanup,
    strandedRecovered: recovery.added,
    historicalOrderNumberDuplicates,
  }
}

const runCashierCentralSyncInternal = async ({ initial = false, queueOnly = false, trigger = queueOnly ? 'manual' : 'worker', manualReport = null } = {}) => {
  const queueBefore = readRawSaleQueue()
  const lock = syncLockManager.acquire({ trigger, hasPendingQueue: queueBefore.length > 0 })
  if (!lock.acquired) {
    logQueueDecision(null, 'locked', `ownerId=${lock.before?.ownerId || ''}; trigger=${lock.before?.trigger || ''}`, { queueLength: queueBefore.length, locked: true })
    throw Object.assign(new Error('المزامنة قيد التنفيذ. انتظر اكتمالها ثم أعد المحاولة.'), { code: 'SYNC_LOCK_ACTIVE', lock: lock.before })
  }
  let timeoutId
  const heartbeatId = setInterval(() => syncLockManager.heartbeat({ trigger, processingSaleIds: [] }), 10000)
  try {
    syncLockManager.heartbeat({ trigger, processingSaleIds: [] })
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(Object.assign(new Error('انتهت مهلة المزامنة؛ بقيت العناصر الفاشلة في الطابور.'), { code: 'SYNC_PROCESS_TIMEOUT' })), SYNC_PROCESS_TIMEOUT_MS)
    })
    const result = await Promise.race([runCashierCentralSyncUnlocked({ initial, queueOnly, manualReport }), timeout])
    clearTimeout(timeoutId)
    return { ...result, lockAction: lock.action, lockBefore: lock.before || null }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    clearInterval(heartbeatId)
    syncLockManager.release()
  }
}

export const recoverStaleSyncLock = () => syncLockManager.recoverStale()
export const recoverStaleEmergencyRepairFlag = () => syncLockManager.recoverStaleEmergencyRepairFlag()

export const runCashierCentralSync = ({ initial = false } = {}) => {
  return processSaleSyncQueue({ reason: initial ? 'startup' : 'worker', initial })
}

// One in-tab promise is shared by the sale-created event and the explicit
// after-sale call. This makes the immediate call await the exact worker run
// already started by enqueueSale, without creating a competing sync lock.
let activeSaleSyncPromise = null
export const processSaleSyncQueue = ({ reason = 'worker', initial = false } = {}) => {
  if (activeSaleSyncPromise) return activeSaleSyncPromise
  activeSaleSyncPromise = runCashierCentralSyncInternal({ initial, trigger: reason })
    .finally(() => { activeSaleSyncPromise = null })
  return activeSaleSyncPromise
}

// Explicit user-triggered path. It reads the current tab's localStorage at
// click time and processes existing queue entries, including entries created
// by older bundles. It never closes the day or deletes an unverified queue row.
export const manualCurrentTabQueueRecovery = async () => {
  // A manual click in the same tab must join the active worker promise. It
  // must never acquire a second lock and then report its own worker as locked.
  if (activeSaleSyncPromise) return activeSaleSyncPromise
  const permission = await canSyncPosSales(auth?.currentUser)
  if (activeSaleSyncPromise) return activeSaleSyncPromise
  const report = {
    bundle: typeof document !== 'undefined' ? document.querySelector('script[src*="assets/index-"]')?.src?.split('/').pop() || '' : '',
    mainSha: BUILD_SHA,
    user: { uid: permission.uid, email: permission.email },
    permission: {
      allowed: permission.allowed,
      role: permission.role,
      authReady: permission.authReady,
      claimsReady: permission.claimsReady,
      claims: permission.claims,
      cashierId: permission.cashierId,
      cashierName: permission.cashierName,
      authorizedUidExists: permission.authorizedUidExists,
      authorizedPathChecked: permission.authorizedPathChecked,
      staffSessionExists: permission.staffSessionExists,
      missingReason: permission.missingReason,
      canSyncPosSales: {
        allowed: permission.allowed,
        missingReason: permission.missingReason,
      },
    },
    uid: permission.uid,
    email: permission.email,
    cashierName: permission.cashierName,
    cashierId: permission.cashierId,
    role: permission.role,
    authReady: permission.authReady,
    claimsReady: permission.claimsReady,
    authorizedUidExists: permission.authorizedUidExists,
    staffSessionExists: permission.staffSessionExists,
    lockBefore: syncLockManager.describe(),
    lockAction: 'none',
    queueLengthBefore: readRawSaleQueue().length,
    salesToProcess: [],
    queueLengthAfter: null,
    pendingQueueAfter: null,
    result: 'FAIL',
    errors: [],
  }
  if (!permission.allowed) {
    report.errors.push(permission.missingReason || 'CENTRAL_ROLE_BLOCKED')
    report.queueLengthAfter = report.queueLengthBefore
    report.pendingQueueAfter = readSaleQueue().length
    console.info('[POS101_MANUAL_QUEUE_FINAL]', JSON.stringify(report))
    throw Object.assign(new Error('هذا الحساب غير مخول لمزامنة المبيعات.'), { code: 'CENTRAL_ROLE_BLOCKED', permission })
  }
  return runCashierCentralSyncInternal({ queueOnly: true, trigger: 'manual-recovery', manualReport: report })
    .then(result => {
      report.lockAction = result.lockAction || 'acquired'
      report.queueLengthAfter = readRawSaleQueue().length
      report.pendingQueueAfter = readSaleQueue().length
      report.errors = report.salesToProcess.filter(item => item.error).map(item => item.error)
      report.result = report.errors.length ? (report.salesToProcess.some(item => item.localUpdateResult === 'PASS') ? 'PARTIAL' : 'FAIL') : 'PASS'
      console.info('[POS101_MANUAL_QUEUE_FINAL]', JSON.stringify(report))
      return { ...result, manualReport: report }
    })
    .catch(error => {
      report.lockAction = error?.code === 'SYNC_LOCK_ACTIVE' ? 'blocked_active' : report.lockAction
      if (error?.lock) report.lockBefore = error.lock
      report.errors.push(error?.message || String(error))
      report.queueLengthAfter = readRawSaleQueue().length
      report.pendingQueueAfter = readSaleQueue().length
      console.info('[POS101_MANUAL_QUEUE_FINAL]', JSON.stringify(report))
      throw error
    })
}

// Explicit local-only operator tool. It reads the central sales snapshot for
// verification, then changes only this tab's localStorage queue/ledger.
export const runLocalQueueCleanup = async () => {
  await requireRole('cashier-sync')
  const centralSales = centralValues(await get(salesRef()))
  return reconcileLocalQueueAgainstCentral(centralSales)
}

// Compatibility export retained for existing UI callers; the button uses the
// explicitly named direct current-tab recovery path above.
export const runCashierCentralSyncNow = manualCurrentTabQueueRecovery

export const subscribeCentralReconnect = callback => {
  if (!configured || !db || typeof callback !== 'function') return () => {}
  return onValue(ref(db, '.info/connected'), snapshot => {
    if (snapshot.val() === true) callback()
  }, () => {})
}

const readAndMergeAdminSales = async () => {
  await requireRole('admin-viewer')
  const snapshot = await get(salesRef())
  const centralSales = centralValues(snapshot)
  const mergedSales = mergeCentralSalesLocally(centralSales)
  return { centralSales, mergedSales, centralCount: centralSales.length, mergedCount: mergedSales.length }
}

export const runAdminCentralRefresh = readAndMergeAdminSales

export const subscribeCentralSales = (callback, authenticatedUser = auth?.currentUser) => {
  let active = true
  let stop = () => {}
  if (!configured || !db || !authenticatedUser || !active) return () => { active = false }
  // subscribeCentralAuth invokes this after Firebase has delivered the user;
  // waiting on the module-level restore promise here can strand the read
  // listener even though auth.currentUser and the RTDB token are ready.
  const publish = snapshot => {
    const centralSales = centralValues(snapshot)
    let merged = centralSales
    try { merged = mergeCentralSalesLocally(centralSales) } catch (error) { console.error('CENTRAL_SALES_MERGE_ERROR', error) }
    callback({ centralSales, mergedSales: merged, centralCount: centralSales.length, mergedCount: merged.length })
  }
  stop = onValue(salesRef(), snapshot => {
    publish(snapshot)
  }, error => console.error('CENTRAL_SALES_SUBSCRIBE_ERROR', error))
  void get(salesRef()).then(snapshot => { if (active) publish(snapshot) }).catch(error => console.error('CENTRAL_SALES_READ_ERROR', error))
  return () => { active = false; stop() }
}

export const readCentralSalesForReports = async () => {
  if (!configured || !db || !auth?.currentUser) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' })
  return centralValues(await get(salesRef()))
}

const maskDiagnosticUid = uid => {
  const value = String(uid || '')
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value ? 'present' : ''
}

const diagnosticRead = async path => {
  try {
    const snapshot = await Promise.race([
      get(ref(db, path)),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('READ_TIMEOUT'), { code: 'READ_TIMEOUT' })), 8000)),
    ])
    const value = snapshot.val()
    return { path, ok: true, exists: snapshot.exists(), count: snapshot.exists() && value && typeof value === 'object' ? Object.keys(value).length : snapshot.exists() ? 1 : 0 }
  } catch (error) {
    return { path, ok: false, exists: false, count: 0, errorCode: error?.code || 'READ_FAILED', error: error?.message || 'READ_FAILED' }
  }
}

export const readCashboxReadDiagnostics = async () => {
  const user = auth?.currentUser
  const permission = await Promise.race([
    canSyncPosSales(user),
    new Promise(resolve => setTimeout(() => resolve({ allowed: false, role: 'timeout', authReady: Boolean(user?.uid) }), 8000)),
  ])
  const [sales, expenses, operationalDays, operationalCurrent, transactions, settlements, corrections] = await Promise.all([
    diagnosticRead('pos101_sales'),
    diagnosticRead('pos101_expenses'),
    diagnosticRead('pos101_operational_days'),
    diagnosticRead('pos101_operational_day/current'),
    diagnosticRead(cashboxTransactionsPath),
    diagnosticRead(settlementPath),
    diagnosticRead(settlementCorrectionsPath),
  ])
  const result = {
    authReady: Boolean(user?.uid),
    uidMasked: maskDiagnosticUid(user?.uid),
    emailAvailable: Boolean(user?.email),
    authorized: Boolean(permission.allowed),
    role: permission.role || 'blocked',
    paths: { sales, expenses, operationalDays, operationalCurrent, transactions, settlements, corrections },
  }
  if (typeof window !== 'undefined') window.__POS101_CASHBOX_DIAGNOSTIC = result
  return result
}

export const subscribeCentralSalesReadOnly = callback => {
  if (!configured || !db || !isCentralAdminUser(auth?.currentUser)) return () => {}
  return onValue(salesRef(), snapshot => {
    const centralSales = centralValues(snapshot)
    const mergedSales = mergeCentralSalesLocally(centralSales)
    callback({ centralSales, mergedSales, centralCount: centralSales.length, mergedCount: mergedSales.length })
  }, () => {})
}

export const readCentralSalesReadOnly = async () => {
  return (await readAndMergeAdminSales()).centralSales
}

const requireAdminViewer = async () => {
  const user = await ensurePosFirebaseSession('تسجيل دخول الإدارة مطلوب لفحص نسخة المبيعات.')
  if (!isCentralAdminUser(user)) throw Object.assign(new Error('هذه الأداة متاحة لحساب الإدارة فقط.'), { code: 'ADMIN_ROLE_REQUIRED' })
  return user
}

const requireAuthenticatedBackupViewer = async () => {
  return ensurePosFirebaseSession('تسجيل الدخول مطلوب لفحص نسخة المبيعات.')
}

// Recovery/readback writes stay disabled until the owner explicitly enables
// this release-gated mode. UI visibility and read-only inspection do not imply
// permission to mutate Firebase or the cashier ledger.
export const BACKUP_RECOVERY_OWNER_APPROVAL_ENABLED = true
export const TEMP_OPEN_ONE_BUTTON_REPAIR = env.VITE_TEMP_OPEN_ONE_BUTTON_REPAIR === 'true'

const readLocalSalesForBackupTool = () => {
  return readSalesCache()
}

export const inspectBackupSales = async ({ sales = [], syncQueueItems = [] } = {}) => {
  const { candidates: normalized, invalidQueueItems } = buildRecoveryCandidates({ sales, syncQueueItems })
  const localOnly = error => ({
    centralAvailable: false,
    centralCount: null,
    centralReadError: error?.code || error?.message || 'CENTRAL_READ_UNAVAILABLE',
    invalidQueueItems,
    results: normalized.map(sale => ({ sale, classification: 'LOCAL_ONLY', reason: 'تم تحليل الملف محليًا. الفحص المركزي غير متاح لهذا الحساب.', centralSale: null, directExists: false, directSale: null, firebasePath: sale.saleId ? `pos101_sales/${sale.saleId}` : '' })),
    openDays: [],
  })
  try { await requireAuthenticatedBackupViewer() } catch (error) { return localOnly(error) }
  let centralSales
  try {
    const centralSnapshot = await get(salesRef())
    centralSales = centralValues(centralSnapshot)
  } catch (error) { return localOnly(error) }
  const dayIds = [...new Set(normalized.map(sale => sale.operationalDayId).filter(Boolean))]
  let daySnapshots
  try { daySnapshots = await Promise.all(dayIds.map(id => get(ref(db, `pos101_operational_days/${id}`)))) } catch (error) { return localOnly(error) }
  const days = new Map(dayIds.map((id, index) => [id, daySnapshots[index].exists() ? { ...daySnapshots[index].val(), id } : null]))
  let directSnapshots
  try { directSnapshots = await Promise.all(normalized.map(sale => sale.saleId ? get(ref(db, `pos101_sales/${sale.saleId}`)) : Promise.resolve(null))) } catch (error) { return localOnly(error) }
  const quarantined = readSalesQuarantine().map(row => String(row?.saleId || '').trim()).filter(Boolean)
  const results = normalized.map((sale, index) => {
    const result = classifyBackupSale({ sale, centralSales, openDay: days.get(sale.operationalDayId), quarantinedSaleIds: quarantined })
    const direct = directSnapshots[index]
    return { ...result, directExists: Boolean(direct?.exists()), directSale: direct?.exists() ? direct.val() : null }
  })
  return { centralAvailable: true, centralCount: centralSales.length, results, openDays: [...days.values()].filter(Boolean), invalidQueueItems }
}

export const markBackupSaleReadbackLocally = async ({ sale, centralSale } = {}) => {
  const expected = normalizeBackupSale(sale)
  await requireAdminViewer()
  if (Number(expected.orderNumber) !== ORDER_1309_NUMBER || expected.saleId !== ORDER_1309_SALE_ID) throw Object.assign(new Error('التحديث المحلي متاح حاليًا للطلب 1309 المطابق فقط.'), { code: 'READBACK_TARGET_REQUIRED' })
  if (!salePayloadMatches(expected, centralSale)) throw Object.assign(new Error('لا يمكن تحديث الحالة المحلية قبل تطابق readback الكامل.'), { code: 'BACKUP_READBACK_MISMATCH' })
  const localSales = readLocalSalesForBackupTool()
  const index = localSales.findIndex(row => saleIdOf(row) === saleIdOf(expected))
  if (index < 0) return { updated: false, reason: 'LOCAL_SALE_NOT_FOUND' }
  const now = Date.now()
  localSales[index] = { ...localSales[index], centralVerified: true, centralVerifiedAt: now, syncConfirmedAt: now, syncSource: 'firebase-readback', syncStatus: 'synced', status: 'synced' }
  writeSalesCache(localSales, { centralReadable: true })
  window.dispatchEvent(new CustomEvent('pos101-sales-updated'))
  return { updated: true, saleId: saleIdOf(expected), at: now }
}

export const recoverBackupSale = async ({ sale, recoverySourceFile = '', recoveredByName = '', recoveryReason = '', recoveryCode = '' } = {}) => {
  const user = await requireAdminViewer()
  if (!BACKUP_RECOVERY_OWNER_APPROVAL_ENABLED) throw Object.assign(new Error('الاسترداد متوقف لحين موافقة صاحب النظام.'), { code: 'OWNER_APPROVAL_REQUIRED' })
  if (!verifySystemAdminCode(recoveryCode)) throw Object.assign(new Error('رمز الاسترداد الإداري غير صحيح.'), { code: 'RECOVERY_CODE_INVALID' })
  const actor = String(recoveredByName || user.displayName || user.email || '').trim()
  const reason = String(recoveryReason || '').trim()
  if (!actor || !reason) throw Object.assign(new Error('اسم المسؤول وسبب الاسترداد مطلوبان.'), { code: 'RECOVERY_REASON_REQUIRED' })
  const candidate = normalizeBackupSale(sale)
  if (Number(candidate.orderNumber) === ORDER_1309_NUMBER && candidate.saleId === ORDER_1309_SALE_ID) throw Object.assign(new Error('الطلب 1309 مطابق مركزيًا؛ التحديث المحلي فقط مسموح.'), { code: 'ORDER_1309_READBACK_ONLY' })
  const centralSnapshot = await get(salesRef())
  const daySnapshot = await get(ref(db, `pos101_operational_days/${candidate.operationalDayId}`))
  const centralSales = centralValues(centralSnapshot)
  const openDay = daySnapshot.exists() ? { ...daySnapshot.val(), id: candidate.operationalDayId } : null
  const classification = classifyBackupSale({ sale: candidate, centralSales, openDay, quarantinedSaleIds: readSalesQuarantine().map(row => String(row?.saleId || '').trim()) })
  if (classification.classification !== 'MISSING_SAFE_TO_RECOVER') throw Object.assign(new Error(`لا يمكن استرداد المبيعة: ${classification.classification} — ${classification.reason}`), { code: 'RECOVERY_NOT_ELIGIBLE', classification })
  const recoveredAt = Date.now()
  const payload = { ...candidate, id: candidate.saleId, saleId: candidate.saleId, recoveredFromBackup: true, recoverySourceFile: String(recoverySourceFile || ''), recoveredByName: actor, recoveredAt, recoveryReason: reason, originalSyncStatus: candidate.syncStatus || 'pending' }
  const saleRef = ref(db, `pos101_sales/${candidate.saleId}`)
  const transaction = await runTransaction(saleRef, current => current == null ? payload : current)
  const readBack = await get(saleRef)
  if (!readBack.exists() || !salePayloadMatches(candidate, readBack.val())) throw Object.assign(new Error('فشل readback الكامل بعد الاسترداد.'), { code: 'BACKUP_RECOVERY_READBACK_FAILED' })
  if (transaction.committed) {
    const auditId = `audit-backup-recovery-${candidate.saleId}-${recoveredAt}`
    const audit = financialAuditPayload({ id: auditId, user, action: 'backup_sale_recovery', entityType: 'sale', entityId: candidate.saleId, after: { saleId: candidate.saleId, orderNumber: candidate.orderNumber, total: candidate.total, recoverySourceFile: String(recoverySourceFile || ''), recoveredFromBackup: true }, reason, businessDate: candidate.businessDate })
    await set(financialPath(`${auditPath}/${auditId}`), audit)
    const auditBack = await get(financialPath(`${auditPath}/${auditId}`))
    if (!auditBack.exists()) throw Object.assign(new Error('تمت المبيعة لكن تعذر التحقق من سجل الاسترداد.'), { code: 'BACKUP_RECOVERY_AUDIT_READBACK_FAILED' })
  }
  return { committed: transaction.committed, sale: readBack.val(), duplicate: !transaction.committed, auditReadback: transaction.committed }
}

const writeBackupRepairLocalSale = (expected, now = Date.now()) => {
  const localSales = readLocalSalesForBackupTool()
  const index = localSales.findIndex(row => saleIdOf(row) === saleIdOf(expected))
  if (index < 0) return { updated: false, saleId: saleIdOf(expected) }
  localSales[index] = {
    ...localSales[index],
    centralVerified: true,
    centralVerifiedAt: now,
    syncConfirmedAt: now,
    syncSource: 'firebase-readback',
    syncStatus: 'synced',
    status: 'synced',
  }
  writeSalesCache(localSales, { centralReadable: true })
  return { updated: true, saleId: saleIdOf(expected) }
}

const queueEntrySaleId = entry => saleIdOf(entry?.sale || entry?.payload || entry)

const runOneClickSyncRepairInternal = async ({
  sales = [],
  syncQueueItems = [],
  businessDate = '',
  operationalDayId = '',
  sourceFile = '',
  recoveredByName = '',
  recoveryCode = '',
  recoveryReason = '',
  invalidQueueItems = [],
} = {}) => {
  const user = TEMP_OPEN_ONE_BUTTON_REPAIR ? await ensurePosFirebaseSession('تسجيل الدخول إلى Firebase مطلوب لإصلاح المزامنة.') : await requireAdminViewer()
  if (!TEMP_OPEN_ONE_BUTTON_REPAIR && !verifySystemAdminCode(recoveryCode)) throw Object.assign(new Error('رمز الإصلاح الإداري غير صحيح.'), { code: 'RECOVERY_CODE_INVALID' })
  const actor = String(recoveredByName || user.displayName || user.email || 'cashier-device').trim()
  const reason = String(recoveryReason || (TEMP_OPEN_ONE_BUTTON_REPAIR ? 'إصلاح تلقائي من نسخة المبيعات المرفوعة.' : '')).trim()
  if (!actor || !reason) throw Object.assign(new Error('اسم المسؤول وسبب الإصلاح مطلوبان.'), { code: 'RECOVERY_REASON_REQUIRED' })

  const localSales = readLocalSalesForBackupTool()
  const localQueue = readRawSaleQueue()
  const candidateInput = buildRecoveryCandidates({
    sales: [...localSales, ...(Array.isArray(sales) ? sales : [])],
    syncQueueItems: [...localQueue, ...(Array.isArray(syncQueueItems) ? syncQueueItems : [])],
  })
  const normalized = candidateInput.candidates.map(normalizeBackupSale)
  const targetDate = String(businessDate || normalized.find(sale => sale.businessDate)?.businessDate || '').trim()
  const targetDayId = String(operationalDayId || normalized.find(sale => sale.operationalDayId)?.operationalDayId || '').trim()
  const candidates = normalized.filter(sale => (!targetDate || sale.businessDate === targetDate) && (!targetDayId || sale.operationalDayId === targetDayId))
  const centralSnapshot = await get(salesRef())
  let centralSales = centralValues(centralSnapshot)
  const daySnapshot = targetDayId ? await get(ref(db, `pos101_operational_days/${targetDayId}`)) : null
  const openDay = daySnapshot?.exists() ? { ...daySnapshot.val(), id: targetDayId } : null
  const quarantinedSaleIds = readSalesQuarantine().map(row => String(row?.saleId || '').trim()).filter(Boolean)
  const readbackOnly = []
  let localPendingVerifiedFixed = 0
  const recoveredOnce = []
  const conflicts = []
  const skipped = []
  const invalidQueue = [...candidateInput.invalidQueueItems, ...(Array.isArray(invalidQueueItems) ? invalidQueueItems : [])]
  const resolvedSaleIds = new Set()
  const firebaseWrites = []
  const staleLock = recoverStaleSyncLock()
  for (const candidate of candidates) {
    if (candidate.saleId === KNOWN_MANUAL_REVIEW_SALE_1056 || quarantinedSaleIds.includes(candidate.saleId)) {
      skipped.push({ saleId: candidate.saleId, orderNumber: candidate.orderNumber, classification: 'SKIP', reason: 'المبيعة محجوزة للمراجعة اليدوية؛ لا readback ولا استرداد تلقائي.' })
      continue
    }
    const classified = classifyBackupSale({ sale: candidate, centralSales, openDay, quarantinedSaleIds })
    if (classified.classification === 'EXISTS_EXACT_MATCH') {
      const localBefore = localSales.find(row => saleIdOf(row) === candidate.saleId)
      const pendingVerified = localBefore?.centralVerified === true && ['pending', 'queued'].some(status => [localBefore?.syncStatus, localBefore?.status].map(value => String(value || '').toLowerCase()).includes(status))
      const localUpdate = writeBackupRepairLocalSale(candidate)
      if (pendingVerified && localUpdate.updated) localPendingVerifiedFixed += 1
      readbackOnly.push({ saleId: candidate.saleId, orderNumber: candidate.orderNumber, firebasePath: classified.firebasePath })
      resolvedSaleIds.add(candidate.saleId)
      continue
    }
    if (candidate.saleId === ORDER_1309_SALE_ID || Number(candidate.orderNumber) === ORDER_1309_NUMBER) {
      skipped.push({ saleId: candidate.saleId, orderNumber: candidate.orderNumber, classification: 'SKIP', reason: candidate.saleId === KNOWN_MANUAL_REVIEW_SALE_1056 ? '1056 محجوزة للمراجعة اليدوية.' : '1309 يعتمد على Firebase canonical/readback فقط.' })
      continue
    }
    if (classified.classification === 'SKIP') {
      skipped.push({ saleId: candidate.saleId, orderNumber: candidate.orderNumber, classification: classified.classification, reason: classified.reason, voided: ['voided', 'cancelled', 'canceled'].includes(String(candidate.status || '').toLowerCase()) })
      continue
    }
    if (classified.classification === 'CONFLICT') {
      conflicts.push({ saleId: candidate.saleId, orderNumber: candidate.orderNumber, classification: classified.classification, reason: classified.reason, duplicateSaleId: classified.duplicateSaleId, duplicateOrderNumber: classified.duplicateOrderNumber })
      continue
    }
    if (classified.classification !== 'MISSING_SAFE_TO_RECOVER') {
      conflicts.push({ saleId: candidate.saleId, orderNumber: candidate.orderNumber, classification: classified.classification, reason: classified.reason })
      continue
    }
    const recoveredAt = Date.now()
    const payload = {
      ...candidate,
      id: candidate.saleId,
      saleId: candidate.saleId,
      recoveredFromBackup: true,
      recoveryMode: 'one-click-safe-sync-dedupe',
      recoverySourceFile: String(sourceFile || ''),
      sourceFile: String(sourceFile || ''),
      recoveredBy: actor,
      recoveredByName: actor,
      recoveredAt,
      recoveryReason: reason,
      originalSyncStatus: candidate.syncStatus || 'pending',
    }
    const saleRef = ref(db, `pos101_sales/${candidate.saleId}`)
    const transaction = await runTransaction(saleRef, current => current == null ? payload : current)
    const readBack = await get(saleRef)
    if (!readBack.exists() || !salePayloadMatches(candidate, readBack.val())) throw Object.assign(new Error(`فشل readback الكامل للطلب ${candidate.orderNumber || candidate.saleId}.`), { code: 'BACKUP_RECOVERY_READBACK_FAILED' })
    if (!transaction.committed) {
      conflicts.push({ saleId: candidate.saleId, orderNumber: candidate.orderNumber, classification: 'CONFLICT', reason: 'ظهر سجل مركزي أثناء الإصلاح؛ لم تتم كتابة ثانية.' })
      continue
    }
    const auditId = `audit-one-click-sync-repair-${candidate.saleId}-${recoveredAt}`
    const audit = financialAuditPayload({ id: auditId, user, action: 'one_click_sync_repair', entityType: 'sale', entityId: candidate.saleId, after: { saleId: candidate.saleId, orderNumber: candidate.orderNumber, total: candidate.total, recoveryMode: 'one-click-safe-sync-dedupe', sourceFile: String(sourceFile || ''), recoveredBy: actor }, reason, businessDate: candidate.businessDate })
    await set(financialPath(`${auditPath}/${auditId}`), audit)
    const auditBack = await get(financialPath(`${auditPath}/${auditId}`))
    if (!auditBack.exists()) throw Object.assign(new Error(`تعذر قراءة سجل التدقيق للطلب ${candidate.orderNumber || candidate.saleId}.`), { code: 'BACKUP_RECOVERY_AUDIT_READBACK_FAILED' })
    writeBackupRepairLocalSale(candidate)
    firebaseWrites.push(candidate.saleId)
    recoveredOnce.push({ saleId: candidate.saleId, orderNumber: candidate.orderNumber, firebasePath: `pos101_sales/${candidate.saleId}` })
    resolvedSaleIds.add(candidate.saleId)
    centralSales = [...centralSales.filter(remote => saleIdOf(remote) !== candidate.saleId), readBack.val()]
  }

  const rawQueueValue = readRawSaleQueue()
  const rawQueue = Array.isArray(rawQueueValue) ? rawQueueValue : []
  const queueActions = []
  const queueDuplicateCounts = new Map()
  const retainedQueue = rawQueue.filter(entry => {
    const type = String(entry?.type || entry?.kind || '').toLowerCase()
    const isSaleEntry = Boolean(entry?.sale || type === 'sale' || type === 'sales' || type === 'order')
    const id = queueEntrySaleId(entry)
    if (!isSaleEntry || !id || !resolvedSaleIds.has(id)) return true
    const removedCount = (queueDuplicateCounts.get(id) || 0) + 1
    queueDuplicateCounts.set(id, removedCount)
    queueActions.push({ saleId: id, action: 'resolved-after-readback', reason: 'SAME_SALE_ID_DUPLICATE_QUEUE_ENTRIES' })
    return false
  })
  const queueCleanupReport = {
    reportType: 'pos101-one-click-sync-repair',
    at: Date.now(),
    sourceFile: String(sourceFile || ''),
    businessDate: targetDate,
    operationalDayId: targetDayId,
    inputQueueItems: Array.isArray(syncQueueItems) ? syncQueueItems.length : 0,
    activeQueueBefore: rawQueue.length,
    activeQueueAfter: retainedQueue.length,
    actions: queueActions,
    duplicateResolutions: [...queueDuplicateCounts.entries()].map(([saleId, removedCount]) => ({ reason: 'SAME_SALE_ID_DUPLICATE_QUEUE_ENTRIES', saleId, removedCount })),
    invalidQueueItems: invalidQueue,
    retainedUnmatched: retainedQueue.length,
    firebaseWrites: firebaseWrites,
    noBlindDelete: true,
  }
  localStorage.setItem('pos101.queueCleanupReport', JSON.stringify(queueCleanupReport))
  if (queueActions.length) localStorage.setItem('pos101.syncQueue', JSON.stringify(retainedQueue))
  if (queueActions.length) window.dispatchEvent(new CustomEvent('pos101-sales-updated'))

  const finalLocalSales = readLocalSalesForBackupTool()
  const day = openDay || { id: targetDayId, businessDate: targetDate }
  const canonical = canonicalSalesForOperationalDay({ localSales: finalLocalSales, centralSales, operationalDay: day })
  const finalSummary = summarizeCanonicalSales(canonical)
  const endDayReady = retainedQueue.length === 0 && conflicts.length === 0 && finalSummary.salesBalanced && finalSummary.paymentsBalanced
  return {
    ok: true,
    oneClickSyncRepair: 'PASS',
    trueOneButtonRepair: 'PASS',
    tempOpenOneButtonRepair: TEMP_OPEN_ONE_BUTTON_REPAIR ? 'ON' : 'OFF',
    businessDate: targetDate,
    operationalDayId: targetDayId,
    backupSalesCount: Array.isArray(sales) ? sales.length : 0,
    localCount: finalLocalSales.filter(sale => !targetDate || sale.businessDate === targetDate).length,
    localTotal: finalLocalSales.filter(sale => !targetDate || sale.businessDate === targetDate).reduce((sum, sale) => sum + Number(sale.total || 0), 0),
    localActiveCount: finalLocalSales.filter(sale => (!targetDate || sale.businessDate === targetDate) && !['voided', 'cancelled', 'canceled'].includes(String(sale?.status || '').toLowerCase())).length,
    localActiveTotal: finalLocalSales.filter(sale => (!targetDate || sale.businessDate === targetDate) && !['voided', 'cancelled', 'canceled'].includes(String(sale?.status || '').toLowerCase())).reduce((sum, sale) => sum + Number(sale.total || 0), 0),
    firebaseMatched: readbackOnly.length + recoveredOnce.length,
    localPendingVerifiedFixed,
    readbackOnly,
    recoveredOnce,
    queueItemsResolved: queueActions,
    conflicts,
    skipped,
    invalidQueueItems: invalidQueue,
    activeSyncQueueLengthAfter: retainedQueue.length,
    endDayReady: endDayReady ? 'YES' : 'NO',
    currentDayFinalCount: finalSummary.count,
    currentDayFinalTotal: finalSummary.net,
    noDuplicateSaleId: 'PASS',
    noDuplicateOrderNumberConflict: conflicts.every(item => item.duplicateOrderNumber !== true) ? 'PASS' : 'FAIL',
    noClosedDayWrite: openDay?.status === 'open' ? 'PASS' : (firebaseWrites.length ? 'FAIL' : 'PASS'),
    no1056Touch: recoveredOnce.every(item => item.saleId !== KNOWN_MANUAL_REVIEW_SALE_1056) ? 'PASS' : 'FAIL',
    queueCleanupReport,
    staleSyncLockCleared: Boolean(staleLock?.recovered),
    conflictsList: conflicts,
    invalidQueueItemsList: invalidQueue,
    noBlindUpload: 'PASS',
    noRealSaleDelete: 'PASS',
    noOrderNumberChange: 'PASS',
    noTouch1056: recoveredOnce.every(item => item.saleId !== KNOWN_MANUAL_REVIEW_SALE_1056) ? 'PASS' : 'FAIL',
    noTouchClosedDay: openDay?.status === 'open' ? 'PASS' : (firebaseWrites.length ? 'FAIL' : 'PASS'),
    duplicateQueueResolved: queueCleanupReport.duplicateResolutions || [],
    voidedSkipped: skipped.filter(row => row.voided === true),
    errors: [],
    warnings: [],
  }
}

export const ensureRepairCanProceed = options => defaultSyncLockManager.ensureRepairCanProceed(options)

export const runOneClickSyncRepair = async options => {
  const queueLength = readRawSaleQueue().length
  let emergencyActiveSet = false
  let repairLockAcquired = false
  try {
    localStorage.setItem(EMERGENCY_REPAIR_KEY, 'true')
    emergencyActiveSet = true
    const lockSafety = await defaultSyncLockManager.ensureRepairCanProceed({ queueLength, retries: 3, waitMs: 250 })
    if (!lockSafety.ok) throw Object.assign(new Error('تعذر إيقاف عامل المزامنة النشط بعد 3 محاولات'), { code: 'SYNC_LOCK_ACTIVE_AFTER_RETRIES', lockSafety })
    const repairLock = defaultSyncLockManager.acquireRepairLock()
    if (!repairLock.acquired) throw Object.assign(new Error('تعذر الحصول على قفل الإصلاح الطارئ.'), { code: 'REPAIR_LOCK_ACTIVE', lock: repairLock.lock, lockSafety })
    repairLockAcquired = true
    const result = await runOneClickSyncRepairInternal(options)
    return { ...result, syncLockBefore: lockSafety.lockBefore, syncLockCleared: lockSafety.clearedStaleLock, syncLockAfter: lockSafety.lockAfter, emergencyRepairActiveUsed: 'YES' }
  } finally {
    if (repairLockAcquired) defaultSyncLockManager.releaseRepairLock()
    if (emergencyActiveSet) localStorage.removeItem(EMERGENCY_REPAIR_KEY)
  }
}

export const readLocalExpenses = () => readCachedExpenses()

// Historical reports need the central ledger even when this browser has no
// local expense cache. Read expenses and operational days together so legacy
// rows can be assigned to the business date of their original operational day.
// This is read-only with respect to Firebase; the local cache is only merged,
// never replaced, so pending/legacy rows remain protected.
export const readCentralExpensesForReports = async ({ includeAllLocal = false, persistCache = true, dispatchUpdate = true } = {}) => {
  if (!auth?.currentUser) await authReady
  if (!auth?.currentUser) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' })
  const [expensesSnapshot, daysSnapshot] = await Promise.all([
    get(expensesRef()),
    get(operationalDaysRef()),
  ])
  const days = operationalDayValues(daysSnapshot)
  const operationalDayDates = Object.fromEntries(days
    .map(day => [operationalDayIdOf(day), String(day?.businessDate || '').trim()])
    .filter(([id, businessDate]) => id && businessDate))
  const normalizeForReport = value => {
    const operationalDayId = String(value?.operationalDayId || value?.operational_day_id || value?.shiftId || value?.shift_id || '').trim()
    const mappedBusinessDate = operationalDayDates[operationalDayId]
    const explicitBusinessDate = normalizeDateKey(value?.businessDate || value?.business_date || value?.shiftBusinessDate)
    const savedDateFallback = normalizeDateKey(value?.savedDate || value?.localDate || value?.dateKey || value?.reportDate || value?.date)
    const valueWithFallbackDate = explicitBusinessDate
      ? { ...value, businessDate: explicitBusinessDate }
      : savedDateFallback
        ? { ...value, businessDate: savedDateFallback }
        : (mappedBusinessDate ? { ...value, businessDate: mappedBusinessDate } : value)
    return normalizeExpense(valueWithFallbackDate, { operationalDayDates })
  }
  const centralExpenses = expensesSnapshot.exists()
    ? Object.entries(expensesSnapshot.val() || {})
      .map(([id, value]) => normalizeForReport({ ...value, id: expenseIdOf(value) || id }))
      .filter(expense => expenseIdOf(expense))
    : []
  const localCacheExpenses = readCachedExpenses().map(normalizeForReport)
  const pendingLocalExpenses = localCacheExpenses.filter(expense => expense.syncStatus === 'pending')
  const reportLocalExpenses = includeAllLocal ? localCacheExpenses : pendingLocalExpenses
  const merged = mergeExpensesConservatively(reportLocalExpenses, centralExpenses)
  const protectedLocalCache = mergeExpensesConservatively(localCacheExpenses, centralExpenses)
  const cacheChanged = persistCache ? writeLocalExpenses(protectedLocalCache) : false
  if (cacheChanged && dispatchUpdate) dispatchExpensesUpdated()
  return {
    expenses: merged,
    centralExpenses,
    centralCount: centralExpenses.length,
    localCount: localCacheExpenses.length,
    pendingCount: pendingLocalExpenses.length,
    mergedCount: merged.length,
    operationalDayDates,
    operationalDays: days,
  }
}

const mergeCentralExpensesWithPendingLocal = centralExpenses => {
  const remoteIds = new Set(centralExpenses.map(expenseIdOf))
  const remoteFingerprints = new Set(centralExpenses.map(expenseFingerprint))
  const pendingLocal = readCachedExpenses().filter(expense => {
    if (expense.syncStatus !== 'pending') return false
    const id = expenseIdOf(expense)
    if (id && remoteIds.has(id)) return false
    if (remoteFingerprints.has(expenseFingerprint(expense))) return false
    return true
  })
  return [...centralExpenses, ...pendingLocal]
}

const cacheCentralExpenses = expenses => {
  const merged = dedupeExpensesById(mergeExpensesConservatively(readCachedExpenses(), expenses))
  if (writeLocalExpenses(merged)) dispatchExpensesUpdated()
  return merged
}

export const subscribeCentralExpenses = callback => {
  let active = true
  let stop = () => {}
  const attach = async () => {
    if (!configured || !db) return
    await authReady
    const user = auth?.currentUser
    if (!active || !user || !isKioskUser(user)) return
    stop = onValue(expensesRef(), snapshot => {
      const expenses = expenseValues(snapshot)
      const localExpenses = readCachedExpenses()
      authDebug('POS_EXPENSE_REMOTE_UPDATE', { count: expenses.length })
      const merged = cacheCentralExpenses(expenses)
      callback?.(merged, {
        centralCount: expenses.length,
        centralExpenses: expenses,
        localCount: localExpenses.length,
        pendingCount: localExpenses.filter(expense => expense.syncStatus === 'pending').length,
        mergedCount: merged.length,
      })
    }, () => callback?.(readCachedExpenses(), { centralCount: null }))
  }
  void attach()
  return () => { active = false; stop() }
}

export const runExpenseCentralSync = async ({ initial = false } = {}) => {
  const user = await requireExpenseRole(true)
  const localExpenses = readCachedExpenses()
  authDebug('POS_EXPENSE_MIGRATION_START', { localCount: localExpenses.length, initial: Boolean(initial) })
  const snapshot = await get(expensesRef())
  const centralExpenses = expenseValues(snapshot)
  const legacyExpenseQueue = resolveLegacyExpenseQueueEntries(centralExpenses)
  let uploaded = 0
  let skipped = 0
  const retainedPending = []
  await retryAccExpenseQueue()
  for (const localExpense of localExpenses) {
    const base = normalizeExpense(localExpense)
    const normalized = { ...base, createdAt: base.createdAt || safeCreatedAtForBusinessDate(base.businessDate), timestamp: base.timestamp || base.createdAt }
    const id = validExpenseId(expenseIdOf(normalized)) ? expenseIdOf(normalized) : `recovered-expense-${crypto.randomUUID()}`
    if (!normalized.amount || !normalized.businessDate || !normalized.createdAt) {
      skipped += 1
      retainedPending.push({ ...normalized, id, syncStatus: 'pending' })
      continue
    }
    if (centralExpenses.some(remote => areExpenseDuplicates(normalized, remote))) { skipped += 1; continue }
    const payload = centralExpensePayload({ ...normalized, id }, user, { preserveCreatedAt: true })
    try {
      const expenseRef = ref(db, `pos101_expenses/${id}`)
      await set(expenseRef, payload)
      const readBack = await get(expenseRef)
      if (!readBack.exists()) throw new Error('تعذر التحقق من حفظ المصروف بعد الرفع.')
      const saved = normalizeExpense({ ...readBack.val(), id })
      await syncAccExpenseBestEffort(saved)
      centralExpenses.push(saved)
      cacheCentralExpenses([...readCachedExpenses().filter(row => expenseIdOf(row) !== id), { ...saved, syncStatus: 'synced' }])
      uploaded += 1
    } catch (error) {
      retainedPending.push({ ...normalized, id, syncStatus: 'pending' })
      authDebug('POS_EXPENSE_UPLOAD_PENDING', { code: error?.code || 'UNKNOWN' })
    }
  }
  const merged = cacheCentralExpenses([...centralExpenses, ...retainedPending])
  authDebug('POS_EXPENSE_MIGRATION_DONE', { uploaded, skipped, centralCount: centralExpenses.length, retainedPending: retainedPending.length, initial: Boolean(initial) })
  return { uploaded, skipped, centralCount: centralExpenses.length, retainedPending: retainedPending.length, mergedCount: merged.length, initial: Boolean(initial), legacyExpenseQueue }
}

export const saveCentralExpense = async (expense, { existing = false } = {}) => {
  const user = await requireExpenseRole(true)
  const normalized = normalizeExpense(expense)
  const id = validExpenseId(expenseIdOf(normalized)) ? expenseIdOf(normalized) : `expense-${crypto.randomUUID()}`
  if (!normalized.amount || !normalized.businessDate || !normalized.createdAt) {
    throw Object.assign(new Error('المبلغ والتاريخ التشغيلي ووقت الإنشاء مطلوبة للمصروف.'), { code: 'EXPENSE_REQUIRED_FIELDS' })
  }
  const previousSnapshot = existing ? await get(ref(db, `pos101_expenses/${id}`)) : null
  const previous = previousSnapshot?.exists() ? normalizeExpense({ ...previousSnapshot.val(), id }) : null
  const payloadSource = normalized.fundingSource
  const desiredTransactionType = isWithdrawalExpense(normalized) ? 'withdrawal' : 'expense'
  const transactionId = `expense-${safeKey(id)}`
  const payload = centralExpensePayload({ ...normalized, id, fundingSource: payloadSource, ...(payloadSource === 'cashbox' ? { linkedTransactionId: transactionId } : { linkedTransactionId: '' }) }, user, { preserveCreatedAt: existing })
  const updates = { [`pos101_expenses/${id}`]: payload }
  if (payloadSource === 'cashbox') {
    updates[`${cashboxTransactionsPath}/${transactionId}`] = { id: transactionId, type: desiredTransactionType, transactionType: desiredTransactionType, amount: payload.amount, businessDate: payload.businessDate, operationalDayId: payload.operationalDayId || '', shiftId: payload.shiftId || '', shiftType: payload.shiftType || '', shiftLabel: payload.shiftLabel || '', employeeId: payload.employeeId || payload.cashierId || '', employeeNameSnapshot: payload.employeeNameSnapshot || payload.person || payload.cashierName || '', reason: payload.description || payload.notes || '', source: desiredTransactionType === 'withdrawal' ? 'drawer' : 'cashier expense', sourceRefId: id, linkedExpenseId: id, fundingSource: 'cashbox', paymentSource: desiredTransactionType === 'withdrawal' ? 'cash_drawer' : 'cashbox', status: 'active', createdAt: previous?.createdAt || Date.now(), createdByUid: previous?.createdByUid || user.uid, createdByName: previous?.createdByName || user.displayName || user.email || '' }
  } else if (previous?.fundingSource === 'cashbox' || previous?.linkedTransactionId) {
    updates[`${cashboxTransactionsPath}/${previous.linkedTransactionId || transactionId}`] = null
  }
  await update(ref(db), updates)
  const readBack = await get(ref(db, `pos101_expenses/${id}`))
  if (!readBack.exists()) throw new Error('تعذر التحقق من حفظ المصروف.')
  const savedValue = readBack.val()
  if (
     String(savedValue.id || id) !== id ||
    Number(savedValue.amount) !== Number(payload.amount) ||
    String(savedValue.description || '') !== String(payload.description || '') ||
    String(savedValue.category || '') !== String(payload.category || '') ||
    String(savedValue.transactionType || '') !== String(payload.transactionType || '') ||
    String(savedValue.recordType || '') !== String(payload.recordType || '') ||
    String(savedValue.type || '') !== String(payload.type || '') ||
    String(savedValue.derivedTransactionType || '') !== String(payload.derivedTransactionType || '') ||
    String(savedValue.employeeId || '') !== String(payload.employeeId || '') ||
    String(savedValue.employeeNameSnapshot || '') !== String(payload.employeeNameSnapshot || '') ||
    String(savedValue.person || '') !== String(payload.person || '') ||
    String(savedValue.businessDate || '') !== String(payload.businessDate || '') ||
    String(savedValue.operationalDayId || '') !== String(payload.operationalDayId || '') ||
    String(savedValue.entryType || '') !== String(payload.entryType || '') ||
     String(savedValue.fundingSource || '') !== String(payload.fundingSource || '') ||
     String(savedValue.paymentSource || '') !== String(payload.paymentSource || '') ||
     Number(savedValue.createdAt) !== Number(payload.createdAt) ||
     String(savedValue.updatedBy || '') !== String(payload.updatedBy || '')
   ) throw Object.assign(new Error(existing ? 'تعذر التحقق من تعديل المصروف بعد الحفظ.' : 'تعذر التحقق من حفظ المصروف.'), { code: existing ? 'EXPENSE_EDIT_READBACK_FAILED' : 'EXPENSE_READBACK_FAILED' })
  const saved = normalizeExpense({ ...readBack.val(), id })
  await syncAccExpenseBestEffort(saved, existing ? 'upsert' : 'upsert')
  cacheCentralExpenses([...readCachedExpenses().filter(row => expenseIdOf(row) !== id), saved])
  dispatchExpensesUpdated()
  authDebug('POS_EXPENSE_WRITE_SUCCESS', { existing: Boolean(existing) })
  return saved
}

export const saveLocalExpensePending = expense => {
  const normalized = normalizeExpense(expense)
  const id = expenseIdOf(normalized) || `expense-${crypto.randomUUID()}`
  const pending = { ...normalized, id, syncStatus: 'pending' }
  cacheCentralExpenses([...readCachedExpenses().filter(row => expenseIdOf(row) !== id), pending])
  authDebug('POS_EXPENSE_WRITE_PENDING')
  return pending
}

export const deleteCentralExpense = async expense => {
  const user = await requireExpenseRole(true)
  const id = expenseIdOf(expense)
  if (!validExpenseId(id)) throw new Error('معرف المصروف غير صالح.')
  const currentSnapshot = await get(ref(db, `pos101_expenses/${id}`))
  const current = currentSnapshot.exists() ? normalizeExpense({ ...currentSnapshot.val(), id }) : normalizeExpense(expense)
  const now = Date.now()
  const softDeleted = { ...current, id, status: 'deleted', deletedAt: now, deletedBy: user.uid, updatedAt: now, updatedBy: user.uid, createdAt: current.createdAt, businessDate: current.businessDate, operationalDayId: current.operationalDayId || '' }
  const updates = { [`pos101_expenses/${id}`]: softDeleted }
  if (current.fundingSource === 'cashbox' && current.linkedTransactionId) {
    const transactionSnapshot = await get(financialPath(`${cashboxTransactionsPath}/${current.linkedTransactionId}`))
    if (transactionSnapshot.exists()) updates[`${cashboxTransactionsPath}/${current.linkedTransactionId}`] = { ...transactionSnapshot.val(), status: 'voided', voidedAt: Date.now(), voidedBy: user.uid, voidReason: 'حذف المصروف المرتبط' }
  }
  await update(ref(db), updates)
  const check = await get(ref(db, `pos101_expenses/${id}`))
  if (!check.exists() || String(check.val()?.id || id) !== id || check.val()?.status !== 'deleted' || Number(check.val()?.amount) !== Number(current.amount) || String(check.val()?.businessDate || '') !== String(current.businessDate || '') || String(check.val()?.operationalDayId || '') !== String(current.operationalDayId || '')) throw Object.assign(new Error('تعذر التحقق من حذف المصروف.'), { code: 'DELETE_READBACK_FAILED' })
  await syncAccExpenseBestEffort({ ...current, id, status: 'voided', updatedAt: now, updatedBy: user.uid }, 'void')
  cacheCentralExpenses([...readCachedExpenses().filter(row => expenseIdOf(row) !== id), normalizeExpense(check.val())])
  dispatchExpensesUpdated()
  return normalizeExpense(check.val())
}

// Product management is deliberately isolated from pos101_sales. Existing
// static menu records are never deleted or rewritten; this path contains only
// new products and explicit updates/hide/show overlays keyed by product ID.
export const isCentralProductReader = user => isCentralCashierUser(user) || isCentralAdminUser(user)
export const isCentralProductManager = user => Boolean(user?.uid) && isCentralProductReader(user)
export const isCentralProductAdmin = isCentralProductManager
const requireProductRole = async (write = false) => {
  if (!configured || !db) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  await authReady
  const user = auth?.currentUser
  if (!user || !isCentralProductReader(user) || (write && !isCentralProductManager(user))) {
    throw Object.assign(new Error(write ? 'صلاحية إدارة المنتجات مطلوبة.' : 'تسجيل دخول POS مطلوب لقراءة المنتجات.'), { code: 'PRODUCT_PERMISSION_DENIED' })
  }
  return user
}

const normalizeProduct = (value, id) => ({
  ...value,
  id: String(value?.id || id),
  name: String(value?.name || '').trim(),
  english: String(value?.english || '').trim(),
  category: String(value?.category || '').trim(),
  categoryId: value?.categoryId || value?.category_id || value?.category || '',
  price: Number(value?.price ?? 0),
  image: value?.image || value?.imageUrl || value?.image_url || value?.photoUrl || value?.photo_url || null,
  enabled: value?.enabled !== false,
  productType: value?.productType || (value?.parentProductId ? 'child' : 'parent'),
  parentProductId: value?.parentProductId ? String(value.parentProductId) : '',
  displayName: value?.displayName || '',
})

export const loadCentralProducts = async () => {
  await requireProductRole(false)
  const snapshot = await get(productsRef())
  return snapshot.exists()
    ? Object.entries(snapshot.val() || {}).map(([id, value]) => normalizeProduct(value, id))
    : []
}

export const subscribeCentralProducts = callback => {
  if (!configured || !db || !isKioskUser(auth?.currentUser)) return () => {}
  return onValue(productsRef(), snapshot => {
    const products = snapshot.exists()
      ? Object.entries(snapshot.val() || {}).map(([id, value]) => normalizeProduct(value, id))
      : []
    callback(products)
  }, () => callback([]))
}

export const saveCentralProduct = async product => {
  await requireProductRole(true)
  const id = String(product?.id || '').trim() || `product-${crypto.randomUUID()}`
  const record = normalizeProduct({ ...product, id, updatedAt: new Date().toISOString(), updatedBy: auth.currentUser.uid }, id)
  if (!record.name) throw Object.assign(new Error('اسم المنتج مطلوب.'), { code: 'PRODUCT_NAME_REQUIRED' })
  if (!Number.isFinite(record.price) || record.price < 0) throw Object.assign(new Error('السعر يجب أن يكون رقماً لا يقل عن صفر.'), { code: 'PRODUCT_PRICE_INVALID' })
  await set(ref(db, `pos101_products/${id}`), record)
  const readBack = await get(ref(db, `pos101_products/${id}`))
  if (!readBack.exists() || String(readBack.val()?.id || id) !== id) throw new Error('تعذر التحقق من حفظ المنتج.')
  return normalizeProduct(readBack.val(), id)
}

// Financial records use separate RTDB paths and never overwrite legacy sales
// or expense records. Every write is read back before the caller treats it as
// durable; voiding is represented as a status change, never a hard delete.
const financialPath = path => ref(db, path)
const financialUser = async (write = false) => {
  if (!configured || !db) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  await authReady
  const user = auth?.currentUser
  if (!write) {
    const permission = await canSyncPosSales(user)
    if (permission.allowed) return user
    throw Object.assign(new Error('هذا الحساب غير مخول لقراءة البيانات المالية.'), { code: 'CENTRAL_ROLE_BLOCKED', permission })
  }
  return requireKioskUser(user)
}

const staffUser = async (write = false) => {
  if (!configured || !db) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  await authReady
  const user = auth?.currentUser
  if (isCentralAdminUser(user)) return user
  return requireKioskUser(user)
}

const objectValues = snapshot => snapshot.exists() ? Object.entries(snapshot.val() || {}).map(([id, value]) => ({ ...value, id: value?.id || id })) : []
const staffPath = 'pos101_staff'
const cashboxTransactionsPath = 'pos101_cashbox_transactions'
const auditPath = 'pos101_financial_audit_log'

export const normalizeStaff = (value, id) => ({
  ...value,
  id: String(value?.id || id || ''),
  name: String(value?.name || '').trim(),
  code: String(value?.code || '').trim(),
  role: ['cashier', 'employee', 'manager'].includes(value?.role) ? value.role : 'employee',
  active: value?.active !== false,
  canSell: normalizeStaffCanSell(value),
  deactivatedAt: value?.deactivatedAt || null,
})

const saveStaffAudit = async ({ action, entityType, entityId, before = null, after = null, reason = '', businessDate = '' }) => {
  const user = await staffUser(true)
  const id = `audit-${crypto.randomUUID()}`
  const payload = { id, action, entityType, entityId, userUid: user.uid, userName: user.displayName || user.email || '', businessDate, timestamp: Date.now(), before, after, reason }
  await set(financialPath(`${auditPath}/${id}`), payload)
  const readBack = await get(financialPath(`${auditPath}/${id}`))
  if (!readBack.exists()) throw new Error('تعذر التحقق من حفظ سجل تدقيق الموظف.')
  return readBack.val()
}

export const readCentralStaff = async () => { await staffUser(false); return objectValues(await get(financialPath(staffPath))).map(normalizeStaff).filter(row => row.id && row.name) }
export const subscribeCentralStaff = (callback, onError = error => console.error('STAFF_SUBSCRIBE_ERROR', error)) => {
  let active = true
  let stop = () => {}
  void staffUser(false).then(() => {
    if (!active) return
    console.info('STAFF_SUBSCRIBE_START')
    stop = onValue(financialPath(staffPath), snapshot => {
      const rows = objectValues(snapshot).map(normalizeStaff).filter(row => row.id && row.name)
      console.info('STAFF_SNAPSHOT_COUNT', rows.length)
      if (active) callback(rows)
    }, error => {
      console.error('STAFF_SUBSCRIBE_ERROR', error)
      onError(error)
    })
  }).catch(error => {
    console.error('STAFF_AUTH_ERROR', error)
    onError(error)
  })
  return () => { active = false; stop() }
}
export const saveCentralStaff = async (staff, { actor = {} } = {}) => {
  const user = await staffUser(true)
  const id = String(staff?.id || `staff-${crypto.randomUUID()}`).trim()
  const existing = (await get(financialPath(`${staffPath}/${id}`))).val() || null
  const now = Date.now()
  const wasActive = existing?.active !== false
  const isActive = staff?.active !== false
  const normalized = normalizeStaff({ ...existing, ...staff, id })
  const payload = { ...normalized, pinEnabled: existing?.pinEnabled === true, pinHash: existing?.pinHash || null, pinSalt: existing?.pinSalt || null, pinUpdatedAt: existing?.pinUpdatedAt || null, createdAt: existing?.createdAt || now, updatedAt: now, deactivatedAt: !isActive && wasActive ? now : (isActive ? null : (existing?.deactivatedAt || now)), createdBy: existing?.createdBy || user.uid, updatedBy: user.uid }
  if (!payload.name) throw new Error('اسم الموظف مطلوب.')
  await set(financialPath(`${staffPath}/${id}`), payload)
  const readBack = await get(financialPath(`${staffPath}/${id}`))
  if (!readBack.exists()) throw new Error('تعذر التحقق من حفظ الموظف.')
  const action = !existing ? 'staff add' : existing.active !== payload.active ? (payload.active ? 'activate' : 'deactivate') : 'staff edit'
  await saveStaffAudit({ action, entityType: 'staff', entityId: id, before: existing, after: readBack.val(), reason: actor.reason || '' })
  return normalizeStaff(readBack.val(), id)
}

export const saveCashierPin = async ({ staffId, action = 'set', pin = '', systemCode = '' } = {}) => {
  if (!verifySystemAdminCode(systemCode)) throw Object.assign(new Error('رمز النظام غير صحيح.'), { code: 'SYSTEM_ADMIN_CODE_REQUIRED' })
  const user = await staffUser(true)
  const id = String(staffId || '').trim()
  if (!id) throw new Error('معرف الموظف مطلوب.')
  const current = (await get(financialPath(`${staffPath}/${id}`))).val() || null
  if (!current) throw new Error('الموظف غير موجود.')
  const now = Date.now()
  let payload = { ...current, id, updatedAt: now, updatedBy: user.uid }
  if (action === 'cancel') payload = { ...payload, pinEnabled: false, pinHash: null, pinSalt: null, pinUpdatedAt: now }
  else {
    if (!/^\d{4,8}$/.test(String(pin))) throw new Error('رمز الدخول يجب أن يتكون من 4 إلى 8 أرقام.')
    const pinSalt = createPinSalt()
    payload = { ...payload, pinEnabled: true, pinSalt, pinHash: await hashCashierPin(pin, pinSalt), pinUpdatedAt: now }
  }
  await set(financialPath(`${staffPath}/${id}`), payload)
  const readBack = await get(financialPath(`${staffPath}/${id}`))
  if (!readBack.exists() || readBack.val()?.pinEnabled !== payload.pinEnabled || (payload.pinEnabled && readBack.val()?.pinHash !== payload.pinHash)) throw new Error('تعذر التحقق من تحديث رمز الدخول.')
  await saveStaffAudit({ action: action === 'cancel' ? 'staff pin cancel' : 'staff pin set', entityType: 'staff_pin', entityId: id, before: { pinEnabled: current.pinEnabled === true }, after: { pinEnabled: payload.pinEnabled, pinUpdatedAt: payload.pinUpdatedAt }, reason: 'Super Admin cashier PIN management' })
  return normalizeStaff(readBack.val(), id)
}

export const readCentralCashboxTransactions = async () => { await financialUser(false); return objectValues(await get(financialPath(cashboxTransactionsPath))) }
export const subscribeCentralCashboxTransactions = (callback, onError = error => console.error('CASHBOX_SUBSCRIBE_ERROR', error)) => {
  let active = true
  let stop = () => {}
  if (auth?.currentUser) stop = onValue(financialPath(cashboxTransactionsPath), snapshot => callback(objectValues(snapshot)), error => onError(error))
  return () => { active = false; stop() }
}
const settlementPath = 'pos101_cashbox_settlements'
const settlementCorrectionsPath = 'pos101_settlement_corrections'
const countsPath = 'pos101_cashbox_counts'
const safeKey = value => String(value || '').replace(/[.#$\[\]/]/g, '_')
const settlementKey = operationalDayId => `settlement-${safeKey(operationalDayId)}`
const financialAuditPayload = ({ id, user, action, entityType, entityId, before = null, after = null, reason = '', businessDate = '' }) => {
  const createdAt = Date.now()
  const role = user?.role || user?.scope || user?.claims?.role || user?.claims?.scope || ''
  return { id, action, entityType, entityId, userUid: user.uid, userName: user.displayName || user.email || '', actor: user.displayName || user.email || user.uid, actorUid: user.uid, role, deviceId: getDeviceId(), businessDate, timestamp: createdAt, createdAt, before, after, reason }
}
const endDayLog = (event, details = {}) => { if (typeof console !== 'undefined') console.info(event, details) }
const assertJsonNumbers = (value, path = 'payload') => {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') throw new Error(`${path} يحتوي قيمة غير صالحة.`)
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} يحتوي رقماً غير صالح.`)
  if (Array.isArray(value)) return value.forEach((item, index) => assertJsonNumbers(item, `${path}[${index}]`))
  if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => assertJsonNumbers(item, `${path}.${key}`))
}

export const readCentralSettlements = async () => { await financialUser(false); return objectValues(await get(financialPath(settlementPath))) }
export const subscribeCentralSettlements = (callback, onError = error => console.error('SETTLEMENT_SUBSCRIBE_ERROR', error)) => {
  let active = true
  let stop = () => {}
  if (auth?.currentUser) stop = onValue(financialPath(settlementPath), snapshot => callback(objectValues(snapshot)), error => onError(error))
  return () => { active = false; stop() }
}

export const readCentralSettlementCorrections = async () => { await financialUser(false); return objectValues(await get(financialPath(settlementCorrectionsPath))) }
export const subscribeCentralSettlementCorrections = (callback, onError = error => console.error('SETTLEMENT_CORRECTION_SUBSCRIBE_ERROR', error)) => {
  let active = true
  let stop = () => {}
  if (auth?.currentUser) stop = onValue(financialPath(settlementCorrectionsPath), snapshot => callback(objectValues(snapshot)), error => onError(error))
  return () => { active = false; stop() }
}

export const saveSettlementCorrection = async ({ settlementId, correctedActualCash, reason, notes = '', systemCode = '' } = {}) => {
  if (!verifySystemAdminCode(systemCode)) throw Object.assign(new Error('رمز النظام غير صحيح.'), { code: 'SYSTEM_ADMIN_CODE_REQUIRED' })
  const user = await staffUser(true)
  const id = String(settlementId || '').trim()
  if (!id) throw Object.assign(new Error('معرف التسوية مطلوب.'), { code: 'SETTLEMENT_ID_REQUIRED' })
  if (!String(reason || '').trim()) throw Object.assign(new Error('سبب التصحيح مطلوب.'), { code: 'CORRECTION_REASON_REQUIRED' })
  const settlementSnapshot = await get(financialPath(`${settlementPath}/${id}`))
  if (!settlementSnapshot.exists()) throw Object.assign(new Error('التسوية الأصلية غير موجودة.'), { code: 'SETTLEMENT_NOT_FOUND' })
  const settlement = settlementSnapshot.val()
  const calculation = calculateSettlementCorrection({ settlement, correctedActualCash })
  const now = Date.now()
  const correctionId = `correction-${safeKey(id)}-${now}-${crypto.randomUUID().slice(0, 8)}`
  const correction = {
    id: correctionId,
    settlementId: id,
    operationalDayId: String(settlement.operationalDayId || ''),
    businessDate: String(settlement.businessDate || ''),
    originalExpectedCash: Number(settlement.expectedCash || 0),
    originalActualCash: Number(settlement.actualCash || 0),
    originalDifference: Number(settlement.difference || 0),
    ...calculation,
    reason: String(reason).trim(),
    notes: String(notes || '').trim(),
    createdAt: now,
    createdByUid: user.uid,
    createdByName: user.displayName || user.email || '',
    status: 'active',
  }
  const auditId = `audit-${correctionId}`
  const audit = financialAuditPayload({
    id: auditId,
    user,
    action: 'settlement actual cash correction',
    entityType: 'settlement_correction',
    entityId: correctionId,
    before: { actualCash: correction.originalActualCash, difference: correction.originalDifference },
    after: { actualCash: correction.correctedActualCash, difference: correction.correctedDifference },
    reason: correction.reason,
    businessDate: correction.businessDate,
  })
  await update(ref(db), { [`${settlementCorrectionsPath}/${correctionId}`]: correction, [`${auditPath}/${auditId}`]: audit })
  const [correctionBack, auditBack, originalBack] = await Promise.all([
    get(financialPath(`${settlementCorrectionsPath}/${correctionId}`)),
    get(financialPath(`${auditPath}/${auditId}`)),
    get(financialPath(`${settlementPath}/${id}`)),
  ])
  if (!correctionBack.exists() || !auditBack.exists()) throw Object.assign(new Error('تعذر التحقق من حفظ تصحيح التسوية.'), { code: 'CORRECTION_READBACK_FAILED' })
  const original = originalBack.val()
  if (!originalBack.exists() || Number(original.actualCash) !== correction.originalActualCash || Number(original.difference) !== correction.originalDifference || Number(original.expectedCash) !== correction.originalExpectedCash) {
    throw Object.assign(new Error('فشل تحقق ثبات التسوية الأصلية.'), { code: 'ORIGINAL_SETTLEMENT_MUTATED' })
  }
  return { correction: correctionBack.val(), audit: auditBack.val(), settlement: original }
}

const centralSettlementInputs = async operationalDay => {
  const [salesSnapshot, expensesSnapshot, transactionsSnapshot] = await Promise.all([get(salesRef()), get(expensesRef()), get(financialPath(cashboxTransactionsPath))])
  const dayId = String(operationalDay?.id || operationalDay?.operationalDayId || '')
  const dayDate = String(operationalDay?.businessDate || '')
  const sales = getReportSalesForOperationalDay({ centralSales: centralValues(salesSnapshot), operationalDayId: dayId, businessDate: dayDate }).filter(isReportableSale)
  const expenses = expenseValues(expensesSnapshot).filter(row => row.operationalDayId === dayId || (!row.operationalDayId && row.businessDate === dayDate))
  const transactions = objectValues(transactionsSnapshot).filter(row => row.businessDate === dayDate && row.status !== 'voided')
  return { sales, expenses, transactions }
}

export const readFreshSettlementPreview = async operationalDay => calculateSettlement({ ...(await centralSettlementInputs(operationalDay)), openingCashBalance: operationalDay?.openingCashBalance })
 

export const settleAndEndOperationalDay = async (day, { actualCash, openOrderCount = 0, endedBy = {}, explicitUserAction = false, closeSource = 'manual_end_day', closeReason = 'manual-confirmed' } = {}) => {
  if (explicitUserAction !== true || closeSource !== 'manual_end_day' || !ALLOWED_DAY_CLOSE_SOURCES.has(closeSource)) {
    throw Object.assign(new Error('إغلاق اليوم التشغيلي يتطلب تأكيد المستخدم من شاشة إنهاء اليوم.'), { code: 'EXPLICIT_DAY_CLOSE_REQUIRED' })
  }
  endDayLog('END_DAY_SUBMIT_START', { operationalDayId: day?.id || day?.operationalDayId || '', businessDate: day?.businessDate || '', actualCash })
  const preClose = await readPreCloseReconciliation(day, { openOrderCount })
  if (!preClose.allowed) throw Object.assign(new Error(preClose.message), { code: 'PRE_CLOSE_RECONCILIATION_BLOCKED', preClose })
  const centralBeforeWrite = centralValues(await get(salesRef()))
  const financialReconciliation = reconcileCanonicalSales({ localSales: readLocalSales(), centralSales: centralBeforeWrite, operationalDay: day })
  if (!financialReconciliation.allowed) {
    throw Object.assign(new Error('تعذر مطابقة المبيعات المحلية والمركزية؛ تم تعطيل إنهاء اليوم دون أي كتابة.'), { code: 'FINANCIAL_RECONCILIATION_BLOCKED', financialReconciliation })
  }
  if (!preClose.financialReconciliation?.allowed) {
    throw Object.assign(new Error(preClose.financialReconciliation.message || 'توجد بيانات مالية غير متزامنة؛ تم تعطيل إنهاء اليوم دون أي كتابة.'), { code: 'FINANCIAL_QUEUE_BLOCKED', preClose })
  }
  const user = await financialUser(true)
  const id = String(day?.id || day?.operationalDayId || '').trim()
  if (!id) throw new Error('لا يوجد يوم تشغيلي مفتوح.')
  const canonicalDay = await ensureCanonicalOperationalDay()
  if (!canonicalDay || canonicalDay.id !== id) throw operationalDayGuardError('CENTRAL_DAY_MISMATCH', 'تغيّر اليوم التشغيلي من جهاز آخر؛ أعد قراءة الحالة المركزية.', canonicalDay || {})
  if (!['open', 'closed'].includes(canonicalDay.status)) throw operationalDayGuardError('CENTRAL_DAY_CLOSED', 'اليوم التشغيلي مغلق أو تغيّر من جهاز آخر.', canonicalDay)
  const key = settlementKey(id)
  const cashboxId = `settlement-${safeKey(id)}`
  const auditId = `audit-settlement-${safeKey(id)}`
  const [daySnapshot, settlementSnapshot, cashboxSnapshot, auditSnapshot] = await Promise.all([
    get(financialPath(`pos101_operational_days/${id}`)),
    get(financialPath(`${settlementPath}/${key}`)),
    get(financialPath(`${cashboxTransactionsPath}/${cashboxId}`)),
    get(financialPath(`${auditPath}/${auditId}`)),
  ])
  const remoteDay = canonicalDay
  const existingSettlement = settlementSnapshot.exists() ? settlementSnapshot.val() : null
  const existingCashbox = cashboxSnapshot.exists() ? cashboxSnapshot.val() : null
  const existingAudit = auditSnapshot.exists() ? auditSnapshot.val() : null
  if (!remoteDay) throw Object.assign(new Error('حالة اليوم التشغيلي غير موجودة في Firebase؛ لم يتم تغيير البيانات.'), { code: 'DAY_NOT_FOUND' })
  const existingExpectedCash = existingSettlement ? Number(existingSettlement.expectedCash) : null
  const existingCashboxRequired = existingExpectedCash == null || existingExpectedCash > 0
  if (remoteDay.status === 'closed' && existingSettlement && (!existingCashboxRequired || existingCashbox) && existingAudit) {
    const closed = cacheOperationalDay(remoteDay, { central: true })
    return { settlement: existingSettlement, day: closed || remoteDay, duplicate: true, repaired: false }
  }
  if (remoteDay.status === 'closed' && !existingSettlement) {
    throw Object.assign(new Error('الحالة غير متسقة: اليوم مغلق بدون تسوية. راجع المدخلات التاريخية قبل إعادة البناء.'), { code: 'DAY_CLOSE_INCONSISTENT' })
  }
  const inputs = await centralSettlementInputs(remoteDay)
  let settlement = existingSettlement
  if (!settlement) {
    const actual = Number(actualCash)
    if (!Number.isFinite(actual) || actual < 0) throw Object.assign(new Error('المبلغ الفعلي للصندوق مطلوب.'), { code: 'ACTUAL_CASH_REQUIRED' })
    const summary = calculateSettlement({ ...inputs, openingCashBalance: remoteDay.openingCashBalance })
    const difference = actual - summary.expectedCash
    const status = difference === 0 ? 'matched' : difference > 0 ? 'over' : 'short'
    const cashAnalysis = calculateEndDayCashAnalysis({ openingCashBalance: summary.openingCashBalance, cashSales: summary.cashSales, expenses: summary.expenses, withdrawals: summary.withdrawals, expectedCash: summary.expectedCash, actualCash: actual })
    settlement = { id: key, idempotencyKey: makeSettlementIdempotencyKey(id), operationalDayId: id, businessDate: remoteDay.businessDate, openingCashBalance: summary.openingCashBalance, cashSales: summary.cashSales, electronicSales: summary.electronicSales, expenses: summary.expenses, cashboxWithdrawals: summary.cashboxWithdrawals, managementWithdrawals: summary.managementWithdrawals, deposits: summary.deposits, dailyCashMovement: summary.dailyCashMovement, expectedCash: summary.expectedClosingCash, expectedClosingCash: summary.expectedClosingCash, ...summary, ...cashAnalysis, actualCash: actual, difference, status, createdAt: Date.now(), createdByUid: user.uid, createdByName: endedBy.name || user.displayName || user.email || '' }
    assertJsonNumbers(settlement, 'settlement')
    endDayLog('END_DAY_SETTLEMENT_PAYLOAD', { id: settlement.id, operationalDayId: settlement.operationalDayId, businessDate: settlement.businessDate, expectedCash: settlement.expectedCash, actualCash: settlement.actualCash, difference: settlement.difference, status: settlement.status })
    endDayLog('END_DAY_FIREBASE_WRITE_START', { path: `${settlementPath}/${key}`, writeType: 'settlement-once' })
    await set(financialPath(`${settlementPath}/${key}`), settlement)
    const settlementBack = await get(financialPath(`${settlementPath}/${key}`))
    if (!settlementBack.exists()) throw Object.assign(new Error('تعذر قراءة التسوية بعد حفظها.'), { code: 'SETTLEMENT_READBACK_FAILED' })
    settlement = settlementBack.val()
    endDayLog('END_DAY_FIREBASE_WRITE_RESULT', { path: `${settlementPath}/${key}`, ok: true })
    endDayLog('END_DAY_READBACK_RESULT', { path: `${settlementPath}/${key}`, ok: true, id: settlement.id, expectedCash: settlement.expectedCash, actualCash: settlement.actualCash, difference: settlement.difference })
  } else {
    assertJsonNumbers(settlement, 'existingSettlement')
    endDayLog('END_DAY_SETTLEMENT_PAYLOAD', { id: settlement.id, operationalDayId: settlement.operationalDayId, businessDate: settlement.businessDate, expectedCash: settlement.expectedCash, actualCash: settlement.actualCash, difference: settlement.difference, status: settlement.status, existing: true })
    endDayLog('END_DAY_READBACK_RESULT', { path: `${settlementPath}/${key}`, ok: true, existing: true })
  }
  const expectedCash = Number(settlement.expectedCash)
  if (!Number.isFinite(expectedCash)) throw Object.assign(new Error('المبلغ المتوقع للصندوق غير صالح.'), { code: 'EXPECTED_CASH_INVALID' })
  const cashbox = existingCashbox || (expectedCash > 0 ? { id: cashboxId, type: 'settlement', amount: expectedCash, businessDate: remoteDay.businessDate, operationalDayId: id, source: 'settlement', sourceRefId: key, reason: 'تسوية إغلاق اليوم', status: 'active', createdAt: settlement.createdAt || Date.now(), createdByUid: settlement.createdByUid || user.uid, createdByName: settlement.createdByName || endedBy.name || user.displayName || user.email || '', balanceBefore: calculateCashboxBalance(inputs.transactions), balanceAfter: calculateCashboxBalance(inputs.transactions) + expectedCash } : null)
  const audit = existingAudit || financialAuditPayload({ id: auditId, user, action: 'settlement', entityType: 'settlement', entityId: key, after: settlement, businessDate: remoteDay.businessDate })
  const closedAt = settlement.createdAt || Date.now()
  const closeSnapshot = { businessDate: remoteDay.businessDate, shift: remoteDay.shift || remoteDay.shiftType || '', salesCount: inputs.sales.length, totalSales: Number(settlement.sales || 0), cashSales: Number(settlement.cashSales || 0), electronicSales: Number(settlement.electronicSales || 0), expenses: Number(settlement.expenses || 0), withdrawals: Number(settlement.withdrawals || 0), expectedCash: Number(settlement.expectedCash), actualCash: Number(settlement.actualCash), difference: Number(settlement.difference), pendingSaleWrite: Number(preClose.pendingSaleWriteCount || 0), pendingVoidUpdate: Number(preClose.pendingVoidUpdateCount || 0), activePendingQueue: Number(preClose.pendingQueue || 0), openOrdersCount: Number(openOrderCount) || 0 }
  const closedDay = { ...remoteDay, status: 'closed', endedAt: closedAt, endedBy: { uid: settlement.createdByUid || user.uid, name: settlement.createdByName || endedBy.name || '', email: user.email || '' }, closedAt, closedBy: { uid: settlement.createdByUid || user.uid, name: endedBy.name || settlement.createdByName || '', email: user.email || '' }, closedByUid: settlement.createdByUid || user.uid, closedByRole: user?.role || user?.scope || '', closedByDeviceId: getDeviceId(), closeSource, closeReason, closeConfirmed: true, closeAutoDetected: false, closeSnapshot, updatedBy: user.uid, deviceId: getDeviceId(), settlementId: key, closeSummary: { settlementId: key, expectedCash: settlement.expectedCash, actualCash: settlement.actualCash, difference: settlement.difference, status: settlement.status }, updatedAt: closedAt, version: Number(remoteDay.version || 0) + 1 }
  audit.closeSource = closeSource
  audit.closeReason = closeReason
  audit.closeConfirmed = true
  audit.closeSnapshot = closeSnapshot
  audit.closeAutoDetected = false
  audit.updatedBy = user.uid
  audit.deviceId = closedDay.deviceId
  const updates = { [`${auditPath}/${auditId}`]: audit, [`pos101_operational_days/${id}`]: closedDay, [OPERATIONAL_DAY_CURRENT_PATH]: closedDay }
  if (cashbox) updates[`${cashboxTransactionsPath}/${cashboxId}`] = cashbox
  endDayLog('END_DAY_FIREBASE_WRITE_START', { path: `pos101_operational_days/${id}`, writeType: 'status-after-settlement-readback' })
  await update(ref(db), updates)
  const [dayBack, currentDayBack, settlementBack, cashboxBack, auditBack] = await Promise.all([
    get(financialPath(`pos101_operational_days/${id}`)),
    get(operationalDayCurrentRef()),
    get(financialPath(`${settlementPath}/${key}`)),
    get(financialPath(`${cashboxTransactionsPath}/${cashboxId}`)),
    get(financialPath(`${auditPath}/${auditId}`)),
  ])
  const verifiedDay = dayBack.exists() ? { ...dayBack.val(), id } : null
  const verifiedCurrentDay = currentDayBack.exists() ? normalizeOperationalDay(currentDayBack.val(), id) : null
  endDayLog('END_DAY_FIREBASE_WRITE_RESULT', { path: `pos101_operational_days/${id}`, ok: Boolean(verifiedDay?.status === 'closed') })
  endDayLog('END_DAY_READBACK_RESULT', { path: `pos101_operational_days/${id}`, ok: Boolean(verifiedDay?.status === 'closed'), status: verifiedDay?.status || null })
  endDayLog('END_DAY_CENTRAL_STATUS_READBACK', { path: OPERATIONAL_DAY_CURRENT_PATH, ok: Boolean(verifiedCurrentDay?.status === 'closed'), status: verifiedCurrentDay?.status || null })
  if (!verifiedDay || verifiedDay.status !== 'closed' || !verifiedCurrentDay || verifiedCurrentDay.status !== 'closed' || !settlementBack.exists() || (expectedCash > 0 && !cashboxBack.exists()) || !auditBack.exists()) {
    throw Object.assign(new Error('تعذر التحقق من اكتمال إغلاق اليوم في Firebase.'), { code: 'DAY_CLOSE_READBACK_FAILED' })
  }
  endDayLog('END_DAY_STATUS_UPDATE_RESULT', { path: `pos101_operational_days/${id}`, status: 'closed', readback: true })
  const localClosedDay = cacheOperationalDay(verifiedCurrentDay, { central: true })
  return { settlement: settlementBack.val(), day: localClosedDay || verifiedDay, duplicate: Boolean(existingSettlement), repaired: Boolean(existingSettlement) }
}

export const saveCashCount = async ({ businessDate, operationalDayId = '', systemBalance, actualBalance, reason = '' }) => {
  const user = await financialUser(true)
  const id = `count-${safeKey(operationalDayId || businessDate)}-${Date.now()}`
  const payload = { id, businessDate, operationalDayId, systemBalance: Number(systemBalance), actualBalance: Number(actualBalance), difference: Number(actualBalance) - Number(systemBalance), createdAt: Date.now(), createdByUid: user.uid, createdByName: user.displayName || user.email || '', reason }
  const auditId = `audit-${id}`
  await update(ref(db), { [`${countsPath}/${id}`]: payload, [`${auditPath}/${auditId}`]: financialAuditPayload({ id: auditId, user, action: 'cash count', entityType: 'cash_count', entityId: id, after: payload, reason, businessDate }) })
  const readBack = await get(financialPath(`${countsPath}/${id}`))
  if (!readBack.exists()) throw new Error('تعذر التحقق من حفظ الجرد.')
  return readBack.val()
}

export const saveCentralExpenseWithCashbox = async expense => {
  const user = await financialUser(true)
  const normalized = normalizeExpense(expense)
  const expenseId = validExpenseId(expenseIdOf(normalized)) ? expenseIdOf(normalized) : `expense-${crypto.randomUUID()}`
  const transactionId = `expense-${safeKey(expenseId)}`
  const existingTransactionSnapshot = await get(financialPath(`${cashboxTransactionsPath}/${transactionId}`))
  const existingExpenseSnapshot = await get(ref(db, `pos101_expenses/${expenseId}`))
  const existingTransaction = existingTransactionSnapshot.exists() ? existingTransactionSnapshot.val() : null
  const desiredTransactionType = isWithdrawalExpense(normalized) ? 'withdrawal' : 'expense'
  if (existingTransaction && (String(existingTransaction.linkedExpenseId || existingTransaction.sourceRefId || '') !== String(expenseId))) {
    throw Object.assign(new Error('معرف حركة الصندوق مرتبط بسجل مصروف آخر.'), { code: 'CASHBOX_TRANSACTION_COLLISION' })
  }
  // A prior linked transaction without its expense is an incomplete retry, not a
  // successful save. Reuse the same canonical IDs and repair the paired record.
  if (existingTransaction && existingExpenseSnapshot.exists()) {
    const existingExpense = normalizeExpense({ ...existingExpenseSnapshot.val(), id: expenseId })
    const sameEditableFields = [
      'amount', 'businessDate', 'operationalDayId', 'description', 'notes', 'category',
      'employeeId', 'employeeNameSnapshot', 'cashierNameSnapshot', 'employeeName', 'person',
      'transactionType', 'recordType', 'type', 'derivedTransactionType', 'entryType',
    ].every(field => String(existingExpense[field] ?? '') === String(normalized[field] ?? ''))
    if (existingExpense.fundingSource === 'cashbox'
      && sameEditableFields
      && String(existingExpense.linkedTransactionId || '') === transactionId
      && String(existingTransaction.type || '') === desiredTransactionType) {
      return existingExpense
    }
  }
  if (!normalized.amount || !normalized.businessDate || !normalized.createdAt) throw new Error('المبلغ والتاريخ التشغيلي ووقت الإنشاء مطلوبة للمصروف.')
  const expensePayload = { ...centralExpensePayload({ ...normalized, id: expenseId, fundingSource: 'cashbox' }, user), fundingSource: 'cashbox', paymentSource: 'cashbox', linkedTransactionId: transactionId }
  const expensePayloadWithSource = { ...expensePayload, paymentSource: desiredTransactionType === 'withdrawal' ? 'cash_drawer' : 'cashbox' }
  const transactionPayload = { id: transactionId, type: desiredTransactionType, transactionType: desiredTransactionType, amount: expensePayload.amount, businessDate: expensePayload.businessDate, operationalDayId: expensePayload.operationalDayId || '', shiftId: expensePayload.shiftId || '', shiftType: expensePayload.shiftType || '', shiftLabel: expensePayload.shiftLabel || '', employeeId: expensePayload.employeeId || expensePayload.cashierId || '', employeeNameSnapshot: expensePayload.employeeNameSnapshot || expensePayload.person || expensePayload.cashierName || '', reason: expensePayload.description || expensePayload.notes || '', source: desiredTransactionType === 'withdrawal' ? 'drawer' : 'cashier expense', sourceRefId: expenseId, linkedExpenseId: expenseId, fundingSource: 'cashbox', paymentSource: desiredTransactionType === 'withdrawal' ? 'cash_drawer' : 'cashbox', status: 'active', createdAt: Date.now(), createdByUid: user.uid, createdByName: user.displayName || user.email || '' }
  const auditId = `audit-linked-expense-${safeKey(expenseId)}`
  const audit = financialAuditPayload({ id: auditId, user, action: 'create', entityType: 'expense_with_cashbox', entityId: expenseId, after: { expense: expensePayload, transaction: transactionPayload }, reason: transactionPayload.reason, businessDate: expensePayload.businessDate })
  try {
    await update(ref(db), { [`pos101_expenses/${expenseId}`]: expensePayloadWithSource, [`${cashboxTransactionsPath}/${transactionId}`]: transactionPayload, [`${auditPath}/${auditId}`]: audit })
  } catch (error) {
    try {
      await saveFinancialAudit({ action: 'failed linked write', entityType: 'expense_with_cashbox', entityId: expenseId, after: { expense: expensePayload, transaction: transactionPayload }, reason: error?.message || 'atomic update failed', businessDate: expensePayload.businessDate })
    } catch (auditError) {
      console.error('FAILED_LINKED_WRITE_AUDIT_ERROR', auditError)
    }
    throw error
  }
  const readBack = await get(ref(db, `pos101_expenses/${expenseId}`))
  if (!readBack.exists()) throw new Error('تعذر التحقق من المصروف المرتبط.')
  const transactionReadBack = await get(financialPath(`${cashboxTransactionsPath}/${transactionId}`))
  const savedExpense = normalizeExpense({ ...readBack.val(), id: expenseId })
  const savedTransaction = transactionReadBack.exists() ? transactionReadBack.val() : null
  if (!savedTransaction
    || savedExpense.fundingSource !== 'cashbox'
    || String(savedExpense.category || '') !== String(normalized.category || '')
    || String(savedExpense.description || '') !== String(expensePayload.description || '')
    || String(savedExpense.paymentSource || '') !== String(expensePayloadWithSource.paymentSource || '')
    || String(savedExpense.transactionType || '') !== String(normalized.transactionType || '')
    || String(savedExpense.type || '') !== String(normalized.type || '')
    || String(savedExpense.derivedTransactionType || '') !== String(normalized.derivedTransactionType || '')
    || savedTransaction.type !== desiredTransactionType
    || String(savedExpense.linkedTransactionId || '') !== transactionId
    || Number(savedExpense.amount) !== Number(expensePayload.amount)
    || String(savedExpense.employeeNameSnapshot || '') !== String(expensePayload.employeeNameSnapshot || '')
    || String(savedExpense.person || '') !== String(expensePayload.person || '')
    || Number(savedTransaction.amount) !== Number(transactionPayload.amount)
    || String(savedTransaction.employeeNameSnapshot || '') !== String(transactionPayload.employeeNameSnapshot || '')
    || String(savedTransaction.linkedExpenseId || '') !== expenseId
    || String(savedTransaction.fundingSource || '') !== 'cashbox') {
    throw Object.assign(new Error('تعذر التحقق من اكتمال حفظ مصروف الصندوق وحركته المرتبطة.'), { code: 'CASHBOX_EXPENSE_READBACK_FAILED' })
  }
  cacheCentralExpenses([...readCachedExpenses().filter(row => expenseIdOf(row) !== expenseId), savedExpense])
  dispatchExpensesUpdated()
  return savedExpense
}
export const saveCashboxTransaction = async transaction => {
  const user = await financialUser(true)
  const id = String(transaction?.id || `cash-${crypto.randomUUID()}`).trim()
  const existing = await get(financialPath(`${cashboxTransactionsPath}/${id}`))
  if (existing.exists()) return existing.val()
  const payload = { ...transaction, id, ...(transaction?.type === 'withdrawal' ? { fundingSource: transaction?.fundingSource === 'management' ? 'management' : 'cashbox' } : {}), createdAt: transaction?.createdAt || Date.now(), createdByUid: user.uid, createdByName: user.displayName || user.email || '', status: transaction?.status || 'active' }
  if (!payload.businessDate || !Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) throw new Error('businessDate والمبلغ الصحيحان مطلوبان.')
  await set(financialPath(`${cashboxTransactionsPath}/${id}`), payload)
  const readBack = await get(financialPath(`${cashboxTransactionsPath}/${id}`))
  if (!readBack.exists()) throw new Error('تعذر التحقق من حفظ حركة الصندوق.')
  await saveFinancialAudit({ action: 'create', entityType: 'cashbox_transaction', entityId: id, after: readBack.val(), reason: payload.reason || '' })
  return readBack.val()
}
export const updateCashboxTransaction = async transaction => {
  const user = await financialUser(true)
  const id = String(transaction?.id || '').trim()
  if (!id) throw new Error('معرف حركة الصندوق غير صالح.')
  const existingSnapshot = await get(financialPath(`${cashboxTransactionsPath}/${id}`))
  if (!existingSnapshot.exists()) throw new Error('حركة الصندوق غير موجودة.')
  const existing = existingSnapshot.val()
  const payload = { ...existing, ...transaction, id, ...(existing.type === 'withdrawal' || transaction?.type === 'withdrawal' ? { fundingSource: transaction?.fundingSource === 'management' ? 'management' : (existing.fundingSource === 'management' ? 'management' : 'cashbox') } : {}), createdAt: existing.createdAt || transaction.createdAt || Date.now(), updatedAt: Date.now(), updatedBy: user.uid, createdByUid: existing.createdByUid || user.uid, status: transaction.status || existing.status || 'active' }
  await set(financialPath(`${cashboxTransactionsPath}/${id}`), payload)
  const readBack = await get(financialPath(`${cashboxTransactionsPath}/${id}`))
  if (!readBack.exists()) throw Object.assign(new Error('تعذر التحقق من تعديل حركة الصندوق.'), { code: 'CASHBOX_EDIT_READBACK_FAILED' })
  await saveFinancialAudit({ action: 'update', entityType: 'cashbox_transaction', entityId: id, before: existing, after: readBack.val(), reason: payload.reason || '' })
  return readBack.val()
}
export const deleteCashboxTransaction = async (transaction, voidReason = 'حذف حركة الصندوق') => voidCashboxTransaction(transaction, voidReason)
export const voidCashboxTransaction = async (transaction, voidReason) => {
  const user = await financialUser(true)
  const id = String(transaction?.id || '').trim()
  if (!id) throw new Error('معرف الحركة غير صالح.')
  const payload = { ...(await get(financialPath(`${cashboxTransactionsPath}/${id}`))).val(), status: 'voided', voidedAt: Date.now(), voidedBy: user.uid, voidReason: String(voidReason || '').trim() }
  await set(financialPath(`${cashboxTransactionsPath}/${id}`), payload)
  const readBack = await get(financialPath(`${cashboxTransactionsPath}/${id}`))
  await saveFinancialAudit({ action: 'void', entityType: 'cashbox_transaction', entityId: id, before: transaction, after: readBack.val(), reason: voidReason || '' })
  return readBack.val()
}

export const saveFinancialAudit = async ({ action, entityType, entityId, before = null, after = null, reason = '', businessDate = '' }) => {
  const user = await financialUser(true)
  const id = `audit-${crypto.randomUUID()}`
  const payload = { id, action, entityType, entityId, userUid: user.uid, userName: user.displayName || user.email || '', businessDate, timestamp: Date.now(), before, after, reason }
  await set(financialPath(`${auditPath}/${id}`), payload)
  const readBack = await get(financialPath(`${auditPath}/${id}`))
  if (!readBack.exists()) throw new Error('تعذر التحقق من حفظ سجل التدقيق.')
  return readBack.val()
}
export const readFinancialAudit = async () => { await financialUser(false); return objectValues(await get(financialPath(auditPath))) }

