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
import { areExpenseDuplicates, matchOperationalDayByBusinessDate, mergeExpensesConservatively, normalizeDateKey, normalizeExpense, safeCreatedAtForBusinessDate } from './expenseReporting.js'
import { normalizeStaffCanSell } from './staffEligibility.js'
import { calculateCashboxBalance, calculateSettlement, calculateSettlementCorrection, getEffectiveSettlement, makeSettlementIdempotencyKey } from './financialCenter.js'
import { getKioskDeviceRecord, getOrCreateKioskDeviceRecord, saveKioskIdentity, signKioskChallenge, signatureToBase64Url } from './kioskAuth.js'
import { createPinSalt, hashCashierPin } from './cashierPin.js'
import { verifySystemAdminCode } from './systemAdminCode.js'
import { classifyCentralSale, financialFingerprint, isSaleSyncEligible, markSaleAttempt, markSaleSynced, readRawSaleQueue, readSaleQueue, reconcileSalesAgainstCentral, retainQueuedSale, salePayloadMatches } from './salesSyncQueue.js'
import { getReportSalesForOperationalDay, isReportableSale, readLocalSales } from './reportSales.js'
import { reconcilePreCloseSales } from './preCloseReconciliation.js'
import { buildEndDayDiagnostic } from './endDayDiagnostic.js'
import { reconcileCanonicalSales } from './canonicalSales.js'
import { retryAccSaleQueue, syncAccSaleBestEffort, syncAccExpenseBestEffort, retryAccExpenseQueue } from './accSync.js'
import { defaultSyncLockManager } from './syncLockManager.js'
import { BUILD_SHA } from './versionUpdate.js'

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
const productsRef = () => ref(db, 'pos101_products')
const operationalDaysRef = () => ref(db, 'pos101_operational_days')
const expensesRef = () => ref(db, 'pos101_expenses')
const saleIdOf = sale => String(sale?.saleId || sale?.id || '').trim()
const expenseIdOf = expense => String(expense?.id || expense?.expenseId || '').trim()
const EXPENSES_KEY = 'pos101.expenses'
const OPERATIONAL_DAY_KEY = 'pos101.operationalDay'
const DEVICE_ID_KEY = 'pos101.deviceId'
const readSales = () => {
  try {
    const value = JSON.parse(localStorage.getItem(SALES_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
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
const writeSales = sales => localStorage.setItem(SALES_KEY, JSON.stringify(sales))
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
    return Array.isArray(value) ? value.map(normalizeExpense) : []
  } catch { return [] }
}
const writeLocalExpenses = expenses => {
  const next = JSON.stringify(expenses)
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
    deviceId: normalized.deviceId || getDeviceId(),
    fundingSource: normalized.fundingSource,
    paymentSource: normalized.fundingSource,
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
  && financialFingerprint(expected) === financialFingerprint(actual)
)

const requireRole = async expectedRole => {
  if (!configured) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  const user = await ensurePosFirebaseSession()
  const permission = await canSyncPosSales(user)
  if (!permission.allowed) {
    throw Object.assign(new Error(expectedRole === 'cashier-sync' ? 'هذا الحساب لا يملك صلاحية رفع المبيعات.' : 'تسجيل دخول الإدارة مطلوب للقراءة.'), { code: 'CENTRAL_ROLE_BLOCKED' })
  }
  return user
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
    return value?.status === 'open' && value?.id && value?.businessDate ? value : null
  } catch { return null }
}
const cacheOperationalDay = day => {
  if (day?.status === 'open' && day?.id && day?.businessDate) localStorage.setItem(OPERATIONAL_DAY_KEY, JSON.stringify(day))
  else localStorage.removeItem(OPERATIONAL_DAY_KEY)
  return day
}
const localBusinessDate = timestamp => {
  const date = new Date(timestamp)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const operationalDayValues = snapshot => snapshot.exists()
  ? Object.entries(snapshot.val() || {}).map(([id, value]) => ({ ...value, id: operationalDayIdOf(value) || id }))
  : []
const latestOpenOperationalDay = days => days
  .filter(day => day.status === 'open' && operationalDayIdOf(day))
  .sort((left, right) => Number(right.startedAt || 0) - Number(left.startedAt || 0))[0] || null

export const subscribeOperationalDay = callback => {
  if (!configured || !db || !auth?.currentUser || !isOperationalDayUser(auth.currentUser)) {
    callback(readCachedOperationalDay())
    return () => {}
  }
  return onValue(operationalDaysRef(), snapshot => {
    const day = latestOpenOperationalDay(operationalDayValues(snapshot))
    cacheOperationalDay(day)
    callback(day)
  }, error => {
    console.error('OPERATIONAL_DAY_SUBSCRIBE_ERROR', error)
    callback(readCachedOperationalDay())
  })
}

export const readLocalOperationalDay = readCachedOperationalDay

export const readOpenOperationalDay = async () => {
  await requireOperationalDayRole()
  return cacheOperationalDay(latestOpenOperationalDay(operationalDayValues(await get(operationalDaysRef()))))
}

export const findOperationalDayByBusinessDate = async businessDate => {
  await requireOperationalDayRole()
  const days = operationalDayValues(await get(operationalDaysRef()))
  return { ...matchOperationalDayByBusinessDate(days, businessDate), days }
}

export const readCentralOperationalDays = async () => {
  await requireOperationalDayRole()
  return operationalDayValues(await get(operationalDaysRef()))
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

export const readPreCloseReconciliation = async (operationalDay, { openOrderCount = 0 } = {}) => {
  await financialUser(false)
  const centralSales = centralValues(await get(salesRef()))
  // Readback is also the restart repair path. Persist only sync metadata after
  // exact payload verification; never resend or rewrite the central sale.
  reconcileSalesAgainstCentral(centralSales)
  return reconcilePreCloseSales({ localSales: readSales(), queueEntries: readSaleQueue(), centralSales, operationalDay, openOrderCount })
}

// Read-only diagnostic path. Unlike readPreCloseReconciliation, this deliberately
// does not call reconcileSalesAgainstCentral, so opening the panel cannot persist
// sync metadata, alter the queue, or trigger any retry/upload behavior.
export const readEndDayDiagnostic = async (operationalDay, { openOrderCount = 0, preCloseGuard = null } = {}) => {
  await financialUser(false)
  const centralSales = centralValues(await get(salesRef()))
  return buildEndDayDiagnostic({
    localSales: readLocalSales(),
    queueEntries: readSaleQueue(),
    centralSales,
    operationalDay,
    openOrderCount,
    preCloseGuard,
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
  const transaction = await runTransaction(operationalDaysRef(), current => {
    const days = Object.entries(current || {}).map(([id, value]) => ({ ...value, id: operationalDayIdOf(value) || id }))
    if (latestOpenOperationalDay(days)) return current
    const id = crypto.randomUUID()
    return {
      ...(current || {}),
      [id]: {
        id,
        operationalDayId: id,
        businessDate: localBusinessDate(now),
        startedAt: now,
        startedBy: { uid: user.uid, name: startedBy.name || '', email: user.email || '' },
        openingCashBalance: opening,
        openingCashSource: openingCashSource === 'previous_closing' ? 'previous_closing' : 'manual',
        previousOperationalDayId: String(previousOperationalDayId || ''),
        openingCashAdjustmentNote: String(openingCashAdjustmentNote || '').trim(),
        confirmedAt: now,
        confirmedBy: { uid: user.uid, name: startedBy.name || user.displayName || user.email || '', email: user.email || '' },
        endedAt: null,
        endedBy: null,
        status: 'open',
      },
    }
  })
  return cacheOperationalDay(latestOpenOperationalDay(operationalDayValues(transaction.snapshot)))
}

export const endOperationalDay = async (day, { endedBy = {} } = {}) => {
  const user = await requireOperationalDayRole()
  const id = operationalDayIdOf(day)
  if (!id) throw new Error('لا يوجد يوم تشغيلي مفتوح.')
  const dayRef = ref(db, `pos101_operational_days/${id}`)
  const transaction = await runTransaction(dayRef, current => {
    if (!current || current.status !== 'open') return current
    return { ...current, status: 'closed', endedAt: Date.now(), endedBy: { uid: user.uid, name: endedBy.name || '', email: user.email || '' } }
  })
  const result = transaction.snapshot.exists() ? { ...transaction.snapshot.val(), id } : null
  if (!result || result.status !== 'open') cacheOperationalDay(null)
  else cacheOperationalDay(result)
  return result
}

export const inspectLocalSales = () => {
  const sales = readSales().filter(sale => saleIdOf(sale))
  const latest = sales.slice().sort((a, b) => Number(b.orderNumber || 0) - Number(a.orderNumber || 0))[0]
  return { count: sales.length, latestOrderNumber: latest?.orderNumber ?? null, latestCreatedAt: latest?.createdAt ?? null }
}

export const getCentralSyncState = () => ({ initialSyncCompleted: readInitialSyncCompleted() })

export const mergeCentralSalesLocally = centralSales => {
  const localSales = readSales()
  const merged = mergeBySaleId(localSales, centralSales)
  if (JSON.stringify(merged) !== JSON.stringify(localSales)) {
    writeSales(merged)
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
  const queuedSales = []
  for (const rawEntry of rawQueue) {
    const sale = rawEntry?.sale
    if (!sale) { logQueueDecision(null, 'malformed queue entry', 'missing sale payload', { queueLength: rawQueue.length }); continue }
    if (!isSaleSyncEligible(sale)) { logQueueDecision(sale, 'ineligible', `status=${sale?.status || ''}`, { queueLength: rawQueue.length, eligible: false }); continue }
    queuedSales.push(sale)
  }
  const candidateByIdentity = new Map()
  for (const sale of [...(queueOnly ? [] : localSales), ...queuedSales]) {
    const identity = String(saleIdOf(sale) || sale?.operationKey || sale?.operation_key || '')
    if (identity && !candidateByIdentity.has(identity)) candidateByIdentity.set(identity, sale)
  }
  const before = await get(salesRef())
  const beforeCentral = centralValues(before)
  const centralIds = new Set(beforeCentral.map(saleIdOf))
  const candidates = [...candidateByIdentity.values()].filter(sale => {
    if (!isSaleEligibleForCentralUpload(sale)) { logQueueDecision(sale, 'ineligible', '', { queueLength: rawQueue.length, eligible: false }); return false }
    return true
  })
  const uploadable = candidates
  let uploaded = 0
  let updated = 0
  await retryAccSaleQueue()
  for (const sale of uploadable) {
    syncLockManager.heartbeat({ trigger: queueOnly ? 'manual' : 'worker', processingSaleIds: [saleIdOf(sale)] })
    const queueEntry = readSaleQueue().find(entry => {
      const queued = entry.sale
      return saleIdOf(queued) === saleIdOf(sale)
        || String(queued?.operationKey || queued?.operation_key || '') === String(sale?.operationKey || sale?.operation_key || '')
    })
    const classification = classifyCentralSale(sale, beforeCentral)
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
    if (queueOnly) {
      const missing = ['saleId', 'operationKey', 'businessDate', 'operationalDayId', 'total', 'paymentMethod'].filter(field => {
        if (field === 'saleId') return !saleIdOf(sale)
        if (field === 'operationKey') return !String(sale?.operationKey || sale?.operation_key || '')
        if (field === 'businessDate') return !String(sale?.businessDate || '')
        if (field === 'operationalDayId') return !String(sale?.operationalDayId || sale?.operational_day_id || '')
        if (field === 'paymentMethod') return !String(sale?.paymentMethod || sale?.payment?.method || '')
        return !Number.isFinite(Number(sale?.total ?? sale?.subtotal))
      })
      if (missing.length) {
        const error = Object.assign(new Error(`بيانات المبيعة ناقصة: ${missing.join(',')}`), { code: 'SALE_VALIDATION_FAILED' })
        if (queueEntry) retainQueuedSale(queueEntry, error)
        if (manualSale) manualSale.error = error.message
        continue
      }
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
    if (manualSale) { manualSale.writeAttempted = true; manualSale.writeResult = 'PASS' }
    try {
      await set(saleRef, serializeSale(sale))
    } catch (error) {
      // Another authorized device may have created the same sale concurrently.
      // Continue only when the complete sale identity and business fields read back.
      const readBack = await get(saleRef).catch(() => null)
      if (!readBack?.exists() || !centralSaleMatches(sale, readBack.val())) {
        if (attemptedEntry) retainQueuedSale(attemptedEntry, error)
        if (manualSale) { manualSale.writeResult = 'FAIL'; manualSale.error = error?.message || String(error) }
        logQueueDecision(sale, 'Firebase error', error?.message || '', { queueLength: rawQueue.length, eligible: true, processingStarted: true, firebaseWriteResult: 'failed', readbackResult: 'failed', localUpdateResult: 'retained-in-queue' })
        continue
      }
      if (manualSale) manualSale.writeResult = 'PASS'
    }
    const readBack = await get(saleRef).catch(() => null)
    if (!readBack?.exists() || !centralSaleMatches(sale, readBack.val())) {
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
    skipped: rawQueue.length - uploaded - updated,
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
    syncLockManager.release()
  }
}

export const runCashierCentralSync = ({ initial = false } = {}) => {
  return runCashierCentralSyncInternal({ initial, trigger: 'worker' })
}

// Explicit user-triggered path. It reads the current tab's localStorage at
// click time and processes existing queue entries, including entries created
// by older bundles. It never closes the day or deletes an unverified queue row.
export const manualCurrentTabQueueRecovery = async () => {
  const permission = await canSyncPosSales(auth?.currentUser)
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

export const subscribeCentralSales = callback => {
  if (!configured || !db || !isOperationalDayUser(auth?.currentUser)) return () => {}
  return onValue(salesRef(), snapshot => {
    const centralSales = centralValues(snapshot)
    const merged = mergeCentralSalesLocally(centralSales)
    callback({ centralSales, mergedSales: merged, centralCount: centralSales.length, mergedCount: merged.length })
  }, () => {})
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

export const readLocalExpenses = () => readCachedExpenses()

// Historical reports need the central ledger even when this browser has no
// local expense cache. Read expenses and operational days together so legacy
// rows can be assigned to the business date of their original operational day.
// This is read-only with respect to Firebase; the local cache is only merged,
// never replaced, so pending/legacy rows remain protected.
export const readCentralExpensesForReports = async ({ includeAllLocal = false, persistCache = true, dispatchUpdate = true } = {}) => {
  await requireExpenseRole(false)
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
    const valueWithFallbackDate = explicitBusinessDate
      ? { ...value, businessDate: explicitBusinessDate }
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
  const merged = mergeExpensesConservatively(readCachedExpenses(), expenses)
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
  return { uploaded, skipped, centralCount: centralExpenses.length, retainedPending: retainedPending.length, mergedCount: merged.length, initial: Boolean(initial) }
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
  const transactionId = `expense-${safeKey(id)}`
  const payload = centralExpensePayload({ ...normalized, id, fundingSource: payloadSource, ...(payloadSource === 'cashbox' ? { linkedTransactionId: transactionId } : { linkedTransactionId: '' }) }, user, { preserveCreatedAt: existing })
  const updates = { [`pos101_expenses/${id}`]: payload }
  if (payloadSource === 'cashbox') {
    updates[`${cashboxTransactionsPath}/${transactionId}`] = { id: transactionId, type: 'expense', amount: payload.amount, businessDate: payload.businessDate, operationalDayId: payload.operationalDayId || '', employeeId: payload.employeeId || payload.cashierId || '', employeeNameSnapshot: payload.employeeNameSnapshot || payload.person || payload.cashierName || '', reason: payload.description || payload.notes || '', source: 'cashier expense', sourceRefId: id, linkedExpenseId: id, fundingSource: 'cashbox', status: 'active', createdAt: previous?.createdAt || Date.now(), createdByUid: previous?.createdByUid || user.uid, createdByName: previous?.createdByName || user.displayName || user.email || '' }
  } else if (previous?.fundingSource === 'cashbox' || previous?.linkedTransactionId) {
    updates[`${cashboxTransactionsPath}/${previous.linkedTransactionId || transactionId}`] = null
  }
  await update(ref(db), updates)
  const readBack = await get(ref(db, `pos101_expenses/${id}`))
  if (!readBack.exists()) throw new Error('تعذر التحقق من حفظ المصروف.')
  const savedValue = readBack.val()
  if (existing && (
    Number(savedValue.amount) !== Number(payload.amount) ||
    String(savedValue.description || '') !== String(payload.description || '') ||
    String(savedValue.category || '') !== String(payload.category || '') ||
    String(savedValue.employeeId || '') !== String(payload.employeeId || '') ||
    String(savedValue.employeeNameSnapshot || '') !== String(payload.employeeNameSnapshot || '') ||
    String(savedValue.person || '') !== String(payload.person || '') ||
    String(savedValue.businessDate || '') !== String(payload.businessDate || '') ||
    String(savedValue.operationalDayId || '') !== String(payload.operationalDayId || '') ||
    String(savedValue.entryType || '') !== String(payload.entryType || '') ||
    String(savedValue.fundingSource || '') !== String(payload.fundingSource || '')
  )) throw Object.assign(new Error('تعذر التحقق من تعديل المصروف بعد الحفظ.'), { code: 'EXPENSE_EDIT_READBACK_FAILED' })
  const saved = normalizeExpense({ ...readBack.val(), id })
  await syncAccExpenseBestEffort(saved, existing ? 'upsert' : 'upsert')
  cacheCentralExpenses([...readCachedExpenses().filter(row => expenseIdOf(row) !== id), saved])
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
  // Read-back contract: const check = await get(ref(db, `pos101_expenses/${id}`))
  // DELETE_READBACK_FAILED is raised if the post-update check still exists.
  // Local cache contract: writeLocalExpenses(readCachedExpenses().filter(row => expenseIdOf(row) !== id))
  // The expense deletion remains the canonical set(ref(db, `pos101_expenses/${id}`), null) operation, grouped with the linked transaction void below.
  const updates = { [`pos101_expenses/${id}`]: null }
  if (current.fundingSource === 'cashbox' && current.linkedTransactionId) {
    const transactionSnapshot = await get(financialPath(`${cashboxTransactionsPath}/${current.linkedTransactionId}`))
    if (transactionSnapshot.exists()) updates[`${cashboxTransactionsPath}/${current.linkedTransactionId}`] = { ...transactionSnapshot.val(), status: 'voided', voidedAt: Date.now(), voidedBy: user.uid, voidReason: 'حذف المصروف المرتبط' }
  }
  await update(ref(db), updates)
  const check = await get(ref(db, `pos101_expenses/${id}`))
  if (check.exists()) throw Object.assign(new Error('تعذر التحقق من حذف المصروف.'), { code: 'DELETE_READBACK_FAILED' })
  await syncAccExpenseBestEffort({ ...expense, id, status: 'voided', updatedAt: Date.now() }, 'void')
  writeLocalExpenses(readCachedExpenses().filter(row => expenseIdOf(row) !== id))
  dispatchExpensesUpdated()
  return { id, deletedBy: user.uid }
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
  void financialUser(false).then(() => {
    if (!active) return
    stop = onValue(financialPath(cashboxTransactionsPath), snapshot => callback(objectValues(snapshot)), error => onError(error))
  }).catch(error => onError(error))
  return () => { active = false; stop() }
}
const settlementPath = 'pos101_cashbox_settlements'
const settlementCorrectionsPath = 'pos101_settlement_corrections'
const countsPath = 'pos101_cashbox_counts'
const safeKey = value => String(value || '').replace(/[.#$\[\]/]/g, '_')
const settlementKey = operationalDayId => `settlement-${safeKey(operationalDayId)}`
const financialAuditPayload = ({ id, user, action, entityType, entityId, before = null, after = null, reason = '', businessDate = '' }) => ({ id, action, entityType, entityId, userUid: user.uid, userName: user.displayName || user.email || '', businessDate, timestamp: Date.now(), before, after, reason })

export const readCentralSettlements = async () => { await financialUser(false); return objectValues(await get(financialPath(settlementPath))) }
export const subscribeCentralSettlements = (callback, onError = error => console.error('SETTLEMENT_SUBSCRIBE_ERROR', error)) => {
  let active = true
  let stop = () => {}
  void financialUser(false).then(() => {
    if (!active) return
    stop = onValue(financialPath(settlementPath), snapshot => callback(objectValues(snapshot)), error => onError(error))
  }).catch(error => onError(error))
  return () => { active = false; stop() }
}

export const readCentralSettlementCorrections = async () => { await financialUser(false); return objectValues(await get(financialPath(settlementCorrectionsPath))) }
export const subscribeCentralSettlementCorrections = (callback, onError = error => console.error('SETTLEMENT_CORRECTION_SUBSCRIBE_ERROR', error)) => {
  let active = true
  let stop = () => {}
  void financialUser(false).then(() => {
    if (!active) return
    stop = onValue(financialPath(settlementCorrectionsPath), snapshot => callback(objectValues(snapshot)), error => onError(error))
  }).catch(error => onError(error))
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
 

export const settleAndEndOperationalDay = async (day, { actualCash, openOrderCount = 0, endedBy = {} } = {}) => {
  const preClose = await readPreCloseReconciliation(day, { openOrderCount })
  if (!preClose.allowed) throw Object.assign(new Error(preClose.message), { code: 'PRE_CLOSE_RECONCILIATION_BLOCKED', preClose })
  const centralBeforeWrite = centralValues(await get(salesRef()))
  const financialReconciliation = reconcileCanonicalSales({ localSales: readLocalSales(), centralSales: centralBeforeWrite, operationalDay: day })
  if (!financialReconciliation.allowed) {
    throw Object.assign(new Error('تعذر مطابقة المبيعات المحلية والمركزية؛ تم تعطيل إنهاء اليوم دون أي كتابة.'), { code: 'FINANCIAL_RECONCILIATION_BLOCKED', financialReconciliation })
  }
  const user = await financialUser(true)
  const id = String(day?.id || day?.operationalDayId || '').trim()
  if (!id) throw new Error('لا يوجد يوم تشغيلي مفتوح.')
  const key = settlementKey(id)
  const cashboxId = `settlement-${safeKey(id)}`
  const auditId = `audit-settlement-${safeKey(id)}`
  const [daySnapshot, settlementSnapshot, cashboxSnapshot, auditSnapshot] = await Promise.all([
    get(financialPath(`pos101_operational_days/${id}`)),
    get(financialPath(`${settlementPath}/${key}`)),
    get(financialPath(`${cashboxTransactionsPath}/${cashboxId}`)),
    get(financialPath(`${auditPath}/${auditId}`)),
  ])
  const remoteDay = daySnapshot.exists() ? { ...daySnapshot.val(), id } : null
  const existingSettlement = settlementSnapshot.exists() ? settlementSnapshot.val() : null
  const existingCashbox = cashboxSnapshot.exists() ? cashboxSnapshot.val() : null
  const existingAudit = auditSnapshot.exists() ? auditSnapshot.val() : null
  if (!remoteDay) throw Object.assign(new Error('حالة اليوم التشغيلي غير موجودة في Firebase؛ لم يتم تغيير البيانات.'), { code: 'DAY_NOT_FOUND' })
  if (remoteDay.status === 'closed' && existingSettlement && existingCashbox && existingAudit) {
    cacheOperationalDay(null)
    return { settlement: existingSettlement, day: remoteDay, duplicate: true, repaired: false }
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
    settlement = { id: key, idempotencyKey: makeSettlementIdempotencyKey(id), operationalDayId: id, businessDate: remoteDay.businessDate, openingCashBalance: summary.openingCashBalance, cashSales: summary.cashSales, electronicSales: summary.electronicSales, expenses: summary.expenses, cashboxWithdrawals: summary.cashboxWithdrawals, managementWithdrawals: summary.managementWithdrawals, deposits: summary.deposits, dailyCashMovement: summary.dailyCashMovement, expectedCash: summary.expectedClosingCash, expectedClosingCash: summary.expectedClosingCash, ...summary, actualCash: actual, difference, status, createdAt: Date.now(), createdByUid: user.uid, createdByName: endedBy.name || user.displayName || user.email || '' }
  }
  const expectedCash = Number(settlement.expectedCash || 0)
  const cashbox = existingCashbox || { id: cashboxId, type: 'settlement', amount: Math.max(0, expectedCash), businessDate: remoteDay.businessDate, operationalDayId: id, source: 'settlement', sourceRefId: key, reason: 'تسوية إغلاق اليوم', status: 'active', createdAt: settlement.createdAt || Date.now(), createdByUid: settlement.createdByUid || user.uid, createdByName: settlement.createdByName || endedBy.name || user.displayName || user.email || '', balanceBefore: calculateCashboxBalance(inputs.transactions), balanceAfter: calculateCashboxBalance(inputs.transactions) + Math.max(0, expectedCash) }
  const audit = existingAudit || financialAuditPayload({ id: auditId, user, action: 'settlement', entityType: 'settlement', entityId: key, after: settlement, businessDate: remoteDay.businessDate })
  const closedDay = remoteDay.status === 'closed'
    ? remoteDay
    : { ...remoteDay, status: 'closed', endedAt: settlement.createdAt || Date.now(), endedBy: { uid: settlement.createdByUid || user.uid, name: settlement.createdByName || endedBy.name || '', email: user.email || '' }, settlementId: key }
  const updates = { [`${settlementPath}/${key}`]: settlement, [`${cashboxTransactionsPath}/${cashboxId}`]: cashbox, [`${auditPath}/${auditId}`]: audit, [`pos101_operational_days/${id}`]: closedDay }
  await update(ref(db), updates)
  const [dayBack, settlementBack, cashboxBack, auditBack] = await Promise.all([
    get(financialPath(`pos101_operational_days/${id}`)),
    get(financialPath(`${settlementPath}/${key}`)),
    get(financialPath(`${cashboxTransactionsPath}/${cashboxId}`)),
    get(financialPath(`${auditPath}/${auditId}`)),
  ])
  const verifiedDay = dayBack.exists() ? { ...dayBack.val(), id } : null
  if (!verifiedDay || verifiedDay.status !== 'closed' || !settlementBack.exists() || !cashboxBack.exists() || !auditBack.exists()) {
    throw Object.assign(new Error('تعذر التحقق من اكتمال إغلاق اليوم في Firebase.'), { code: 'DAY_CLOSE_READBACK_FAILED' })
  }
  cacheOperationalDay(null)
  return { settlement: settlementBack.val(), day: verifiedDay, duplicate: Boolean(existingSettlement), repaired: Boolean(existingSettlement) }
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
  if (existingTransaction && (String(existingTransaction.linkedExpenseId || existingTransaction.sourceRefId || '') !== String(expenseId))) {
    throw Object.assign(new Error('معرف حركة الصندوق مرتبط بسجل مصروف آخر.'), { code: 'CASHBOX_TRANSACTION_COLLISION' })
  }
  // A prior linked transaction without its expense is an incomplete retry, not a
  // successful save. Reuse the same canonical IDs and repair the paired record.
  if (existingTransaction && existingExpenseSnapshot.exists()) {
    const existingExpense = normalizeExpense({ ...existingExpenseSnapshot.val(), id: expenseId })
    if (existingExpense.fundingSource === 'cashbox'
      && Number(existingExpense.amount) === Number(normalized.amount)
      && String(existingExpense.businessDate || '') === String(normalized.businessDate || '')
      && String(existingExpense.linkedTransactionId || '') === transactionId) {
      return existingExpense
    }
  }
  if (!normalized.amount || !normalized.businessDate || !normalized.createdAt) throw new Error('المبلغ والتاريخ التشغيلي ووقت الإنشاء مطلوبة للمصروف.')
  const expensePayload = { ...centralExpensePayload({ ...normalized, id: expenseId, fundingSource: 'cashbox' }, user), fundingSource: 'cashbox', paymentSource: 'cashbox', linkedTransactionId: transactionId }
  const transactionPayload = { id: transactionId, type: 'expense', amount: expensePayload.amount, businessDate: expensePayload.businessDate, operationalDayId: expensePayload.operationalDayId || '', employeeId: expensePayload.employeeId || expensePayload.cashierId || '', employeeNameSnapshot: expensePayload.employeeNameSnapshot || expensePayload.person || expensePayload.cashierName || '', reason: expensePayload.description || expensePayload.notes || '', source: 'cashier expense', sourceRefId: expenseId, linkedExpenseId: expenseId, fundingSource: 'cashbox', status: 'active', createdAt: Date.now(), createdByUid: user.uid, createdByName: user.displayName || user.email || '' }
  const auditId = `audit-linked-expense-${safeKey(expenseId)}`
  const audit = financialAuditPayload({ id: auditId, user, action: 'create', entityType: 'expense_with_cashbox', entityId: expenseId, after: { expense: expensePayload, transaction: transactionPayload }, reason: transactionPayload.reason, businessDate: expensePayload.businessDate })
  try {
    await update(ref(db), { [`pos101_expenses/${expenseId}`]: expensePayload, [`${cashboxTransactionsPath}/${transactionId}`]: transactionPayload, [`${auditPath}/${auditId}`]: audit })
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
    || String(savedExpense.linkedTransactionId || '') !== transactionId
    || Number(savedExpense.amount) !== Number(expensePayload.amount)
    || Number(savedTransaction.amount) !== Number(transactionPayload.amount)
    || String(savedTransaction.linkedExpenseId || '') !== expenseId
    || String(savedTransaction.fundingSource || '') !== 'cashbox') {
    throw Object.assign(new Error('تعذر التحقق من اكتمال حفظ مصروف الصندوق وحركته المرتبطة.'), { code: 'CASHBOX_EXPENSE_READBACK_FAILED' })
  }
  cacheCentralExpenses([...readCachedExpenses().filter(row => expenseIdOf(row) !== expenseId), savedExpense])
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

