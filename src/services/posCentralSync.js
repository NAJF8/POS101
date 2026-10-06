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
import { calculateCashboxBalance, calculateSettlement, makeSettlementIdempotencyKey } from './financialCenter.js'
import { getKioskDeviceRecord, getOrCreateKioskDeviceRecord, saveKioskIdentity, signKioskChallenge, signatureToBase64Url } from './kioskAuth.js'
import { isSaleSyncEligible, markSaleSynced, readSaleQueue, retainQueuedSale } from './salesSyncQueue.js'

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
    && Number(actual?.total ?? actual?.subtotal) === Number(expected?.total ?? expected?.subtotal))
}

const requireRole = async expectedRole => {
  if (!configured) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  const user = await ensurePosFirebaseSession()
  if (expectedRole === 'cashier-sync') return requireKioskUser(user)
  if (!await isAuthorizedPosSyncUser(user)) {
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

export const isAuthorizedPosSyncUser = async user => {
  if (!user?.uid) return false
  if (await hydrateKioskClaims(user) && isKioskUser(user)) return true
  return isActiveAuthorizedRecord(await readCentralAuthorizationRecord(user))
}

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

export const startOperationalDay = async ({ startedBy = {} } = {}) => {
  const user = await requireOperationalDayRole()
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
  return merged
}

export const runCashierCentralSync = async ({ initial = false } = {}) => {
  await requireRole('cashier-sync')
  const localSales = readSales()
  const before = await get(salesRef())
  const beforeCentral = centralValues(before)
  const centralIds = new Set(beforeCentral.map(saleIdOf))
  const candidates = (initial || readInitialSyncCompleted())
    ? localSales.filter(isSaleEligibleForCentralUpload)
    : []
  const uploadable = candidates
  let uploaded = 0
  let updated = 0
  for (const sale of uploadable) {
    const saleRef = ref(db, `pos101_sales/${saleIdOf(sale)}`)
    const queueEntry = readSaleQueue().find(entry => {
      const queued = entry.sale
      return saleIdOf(queued) === saleIdOf(sale)
        || String(queued?.operationKey || queued?.operation_key || '') === String(sale?.operationKey || sale?.operation_key || '')
    })
    try {
      await set(saleRef, serializeSale(sale))
    } catch (error) {
      // Another authorized device may have created the same sale concurrently.
      // Continue only when the complete sale identity and business fields read back.
      const readBack = await get(saleRef).catch(() => null)
      if (!readBack?.exists() || !saleReadbackMatches(sale, readBack.val())) {
        if (queueEntry) retainQueuedSale(queueEntry, error)
        throw Object.assign(error, { code: error?.code || 'SALE_READBACK_FAILED' })
      }
    }
    const readBack = await get(saleRef).catch(() => null)
    if (!readBack?.exists() || !saleReadbackMatches(sale, readBack.val())) {
      const error = Object.assign(new Error('تعذر التحقق من حفظ المبيعة المركزية.'), { code: 'SALE_READBACK_FAILED' })
      if (queueEntry) retainQueuedSale(queueEntry, error)
      throw error
    }
    if (centralIds.has(saleIdOf(sale))) updated += 1
    else uploaded += 1
    markSaleSynced(sale)
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
  }
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
  const payload = centralExpensePayload({ ...normalized, id }, user, { preserveCreatedAt: existing })
  await set(ref(db, `pos101_expenses/${id}`), payload)
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
    String(savedValue.paymentSource || '') !== String(payload.paymentSource || '')
  )) throw Object.assign(new Error('تعذر التحقق من تعديل المصروف بعد الحفظ.'), { code: 'EXPENSE_EDIT_READBACK_FAILED' })
  const saved = normalizeExpense({ ...readBack.val(), id })
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
  // RTDB delete is represented by a null set, keeping the operation atomic.
  await set(ref(db, `pos101_expenses/${id}`), null)
  const check = await get(ref(db, `pos101_expenses/${id}`))
  if (check.exists()) throw Object.assign(new Error('تعذر التحقق من حذف المصروف.'), { code: 'DELETE_READBACK_FAILED' })
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
  return requireKioskUser(user)
}

const staffUser = async (write = false) => {
  if (!configured || !db) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  await authReady
  const user = auth?.currentUser
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
  const payload = { ...normalizeStaff({ ...existing, ...staff, id }), createdAt: existing?.createdAt || now, updatedAt: now, deactivatedAt: !isActive && wasActive ? now : (isActive ? null : (existing?.deactivatedAt || now)), createdBy: existing?.createdBy || user.uid, updatedBy: user.uid }
  if (!payload.name) throw new Error('اسم الموظف مطلوب.')
  await set(financialPath(`${staffPath}/${id}`), payload)
  const readBack = await get(financialPath(`${staffPath}/${id}`))
  if (!readBack.exists()) throw new Error('تعذر التحقق من حفظ الموظف.')
  const action = !existing ? 'staff add' : existing.active !== payload.active ? (payload.active ? 'activate' : 'deactivate') : 'staff edit'
  await saveStaffAudit({ action, entityType: 'staff', entityId: id, before: existing, after: readBack.val(), reason: actor.reason || '' })
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

const centralSettlementInputs = async operationalDay => {
  const [salesSnapshot, expensesSnapshot, transactionsSnapshot] = await Promise.all([get(salesRef()), get(expensesRef()), get(financialPath(cashboxTransactionsPath))])
  const dayId = String(operationalDay?.id || operationalDay?.operationalDayId || '')
  const dayDate = String(operationalDay?.businessDate || '')
  const sales = centralValues(salesSnapshot).filter(row => row.operationalDayId === dayId || (!row.operationalDayId && row.businessDate === dayDate))
  const expenses = expenseValues(expensesSnapshot).filter(row => row.operationalDayId === dayId || (!row.operationalDayId && row.businessDate === dayDate))
  const transactions = objectValues(transactionsSnapshot).filter(row => row.businessDate === dayDate && row.status !== 'voided')
  return { sales, expenses, transactions }
}

export const settleAndEndOperationalDay = async (day, { actualCash, endedBy = {} } = {}) => {
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
    const summary = calculateSettlement(inputs)
    const difference = actual - summary.expectedCash
    const status = difference === 0 ? 'matched' : difference > 0 ? 'over' : 'short'
    settlement = { id: key, idempotencyKey: makeSettlementIdempotencyKey(id), operationalDayId: id, businessDate: remoteDay.businessDate, ...summary, actualCash: actual, difference, status, createdAt: Date.now(), createdByUid: user.uid, createdByName: endedBy.name || user.displayName || user.email || '' }
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
  const existingTransactions = objectValues(await get(financialPath(cashboxTransactionsPath)))
  if (existingTransactions.some(row => row.id === transactionId)) return (await get(ref(db, `pos101_expenses/${expenseId}`))).val()
  if (!normalized.amount || !normalized.businessDate || !normalized.createdAt) throw new Error('المبلغ والتاريخ التشغيلي ووقت الإنشاء مطلوبة للمصروف.')
  const expensePayload = { ...centralExpensePayload({ ...normalized, id: expenseId }, user), paymentSource: 'cashbox', linkedTransactionId: transactionId }
  const transactionPayload = { id: transactionId, type: 'expense', amount: expensePayload.amount, businessDate: expensePayload.businessDate, operationalDayId: expensePayload.operationalDayId || '', employeeId: expensePayload.employeeId || expensePayload.cashierId || '', employeeNameSnapshot: expensePayload.employeeNameSnapshot || expensePayload.person || expensePayload.cashierName || '', reason: expensePayload.description || expensePayload.notes || '', source: 'cashier expense', sourceRefId: expenseId, linkedExpenseId: expenseId, status: 'active', createdAt: Date.now(), createdByUid: user.uid, createdByName: user.displayName || user.email || '' }
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
  cacheCentralExpenses([...readCachedExpenses().filter(row => expenseIdOf(row) !== expenseId), normalizeExpense({ ...readBack.val(), id: expenseId })])
  return normalizeExpense({ ...readBack.val(), id: expenseId })
}
export const saveCashboxTransaction = async transaction => {
  const user = await financialUser(true)
  const id = String(transaction?.id || `cash-${crypto.randomUUID()}`).trim()
  const existing = await get(financialPath(`${cashboxTransactionsPath}/${id}`))
  if (existing.exists()) return existing.val()
  const payload = { ...transaction, id, createdAt: transaction?.createdAt || Date.now(), createdByUid: user.uid, createdByName: user.displayName || user.email || '', status: transaction?.status || 'active' }
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
  const payload = { ...existing, ...transaction, id, createdAt: existing.createdAt || transaction.createdAt || Date.now(), updatedAt: Date.now(), updatedBy: user.uid, createdByUid: existing.createdByUid || user.uid, status: transaction.status || existing.status || 'active' }
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

