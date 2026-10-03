import { getApps, initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
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
} from 'firebase/database'
import { areExpenseDuplicates, mergeExpensesConservatively, normalizeDateKey, normalizeExpense } from './expenseReporting.js'

const env = import.meta.env || {}
const localHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
const useEmulator = env.VITE_POS101_USE_FIREBASE_EMULATOR === 'true' && localHost
const emulatorHost = env.VITE_POS101_EMULATOR_HOST || '127.0.0.1'
const emulatorProjectId = env.VITE_POS101_EMULATOR_PROJECT_ID || 'cmms-37512-pos-emulator'

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
let authReady = Promise.resolve()

if (configured) {
  authDebug('POS_AUTH_INIT')
  app = getApps().find(item => item.name === 'pos101-central') || initializeApp(config, 'pos101-central')
  auth = getAuth(app)
  db = getDatabase(app)
  if (useEmulator) {
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true })
    connectDatabaseEmulator(db, emulatorHost, 9000)
  }
  const authStateReady = new Promise(resolve => {
    let stop = () => {}
    stop = onAuthStateChanged(auth, user => {
      stop()
      authDebug(user ? 'POS_AUTH_RESTORED' : 'POS_AUTH_REQUIRED', {
        currentUserExists: Boolean(user),
        provider: user?.providerData?.[0]?.providerId || '',
      })
      resolve(user)
    }, () => resolve(null))
  })
  // Persistence and Firebase's first auth-state callback are one shared gate
  // for sales, expenses, products, and operational-day access.
  authReady = Promise.all([
    setPersistence(auth, browserLocalPersistence).catch(() => {}),
    authStateReady,
  ]).then(([, user]) => user)
}

const SALES_KEY = 'pos101.sales'
const CASHIER_LOGIN_HINT_EMAIL = '101cofeehouse@gmail.com'
export const CENTRAL_SYNC_UID = '4Tx0bMygd8gVuDDDOblnt3HOvo72'
export const ADMIN_UID = 'rtDA9erW11geHfLpa3ZW3LacZR73'
export const ADMIN_EMAIL = 'mohameadalhaear100@gmail.com'
const AUTHORIZED_UIDS_PATH = 'pos101_authorized_uids'
const SYNC_ROLES = new Set(['super_admin', 'admin', 'manager', 'cashier', 'cashier-sync', 'employee', 'admin-viewer'])
const ADMIN_ROLES = new Set(['super_admin', 'admin', 'manager', 'admin-viewer'])
const authorizationCache = new Map()
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

const readCachedExpenses = () => {
  try {
    const value = JSON.parse(localStorage.getItem(EXPENSES_KEY) || '[]')
    return Array.isArray(value) ? value.map(normalizeExpense) : []
  } catch { return [] }
}
const writeLocalExpenses = expenses => localStorage.setItem(EXPENSES_KEY, JSON.stringify(expenses))
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
export const isSaleEligibleForCentralUpload = sale => validSaleId(saleIdOf(sale))

const serializeSale = sale => ({ ...sale, saleId: saleIdOf(sale), id: saleIdOf(sale) })

const requireRole = async expectedRole => {
  if (!configured) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  const user = await ensurePosFirebaseSession()
  if (!await isAuthorizedPosSyncUser(user)) {
    throw Object.assign(new Error(expectedRole === 'cashier-sync' ? 'هذا الحساب لا يملك صلاحية رفع المبيعات.' : 'تسجيل دخول الإدارة مطلوب للقراءة.'), { code: 'CENTRAL_ROLE_BLOCKED' })
  }
  return user
}

const requireOperationalDayRole = async () => {
  if (!configured) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  const user = await ensurePosFirebaseSession('تسجيل دخول POS مطلوب لإدارة اليوم التشغيلي.')
  if (!await isAuthorizedPosSyncUser(user)) {
    throw Object.assign(new Error('هذا الحساب غير مخول لإدارة اليوم التشغيلي.'), { code: 'OPERATIONAL_DAY_PERMISSION_DENIED' })
  }
  return user
}

const requireExpenseRole = async (write = false) => {
  if (!configured || !db) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  const user = await ensurePosFirebaseSession('تسجيل دخول POS مطلوب لمزامنة المصاريف.')
  if (!await isAuthorizedPosSyncUser(user)) throw Object.assign(new Error('هذا الحساب غير مخول لمزامنة المصاريف.'), { code: 'EXPENSE_PERMISSION_DENIED' })
  return user
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
export const subscribeCentralAuth = callback => auth ? onAuthStateChanged(auth, user => {
  if (!user) {
    authorizationCache.clear()
    callback(null)
    return
  }
  void hydrateCentralAuthorization(user).finally(() => callback(user))
}) : () => {}
const normalizedAuthorization = record => record && typeof record === 'object' ? record : null
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
const legacyRole = user => user?.uid === CENTRAL_SYNC_UID ? 'cashier-sync' : user?.uid === ADMIN_UID ? 'admin-viewer' : 'blocked'

export const isAuthorizedPosSyncUser = async user => {
  if (!user?.uid) return false
  const legacy = legacyRole(user)
  if (legacy !== 'blocked') {
    authorizationCache.set(user.uid, { role: legacy === 'admin-viewer' ? 'admin-viewer' : 'cashier-sync', active: true, authorized: true })
    return true
  }
  if (!db) return isActiveAuthorizedRecord(user.pos101Authorization || user.authorization)
  if (authorizationCache.has(user.uid)) return isActiveAuthorizedRecord(authorizationCache.get(user.uid))
  try {
    const snapshot = await get(ref(db, `${AUTHORIZED_UIDS_PATH}/${user.uid}`))
    const record = snapshot.exists() ? normalizedAuthorization(snapshot.val()) : null
    if (record) authorizationCache.set(user.uid, record)
    return isActiveAuthorizedRecord(record)
  } catch {
    return false
  }
}

export const hydrateCentralAuthorization = async user => {
  const allowed = await isAuthorizedPosSyncUser(user)
  if (allowed && user?.uid && !authorizationCache.has(user.uid) && (user.pos101Authorization || user.authorization)) {
    authorizationCache.set(user.uid, user.pos101Authorization || user.authorization)
  }
  return allowed
}

export const getCentralRole = user => {
  const record = user?.pos101Authorization || user?.authorization || (user?.uid ? authorizationCache.get(user.uid) : null)
  return roleFromAuthorization(record) !== 'blocked' ? roleFromAuthorization(record) : legacyRole(user)
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
export const signInCentralWithGoogle = async () => {
  if (!configured || !auth) throw new Error('إعداد Firebase المركزي غير موجود.')
  await authReady
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ login_hint: CASHIER_LOGIN_HINT_EMAIL })
  return (await signInWithPopup(auth, provider)).user
}
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
  }, () => callback(readCachedOperationalDay()))
}

export const readLocalOperationalDay = readCachedOperationalDay

export const readOpenOperationalDay = async () => {
  await requireOperationalDayRole()
  return cacheOperationalDay(latestOpenOperationalDay(operationalDayValues(await get(operationalDaysRef()))))
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
    try {
      await set(saleRef, serializeSale(sale))
      if (centralIds.has(saleIdOf(sale))) updated += 1
      else uploaded += 1
    } catch (error) {
      // Another authorized device may have created the same sale concurrently.
      // A successful read-back of the same saleId is an idempotent retry.
      const readBack = await get(saleRef)
      if (!readBack.exists() || saleIdOf(readBack.val()) !== saleIdOf(sale)) throw error
    }
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
export const readCentralExpensesForReports = async () => {
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
  const localExpenses = readCachedExpenses().map(normalizeForReport)
  const merged = mergeExpensesConservatively(localExpenses, centralExpenses)
  writeLocalExpenses(merged)
  dispatchExpensesUpdated()
  return { expenses: merged, centralCount: centralExpenses.length, operationalDayDates }
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
  writeLocalExpenses(merged)
  dispatchExpensesUpdated()
  return merged
}

export const subscribeCentralExpenses = callback => {
  if (!configured || !db || !isOperationalDayUser(auth?.currentUser)) return () => {}
  return onValue(expensesRef(), snapshot => {
    const expenses = expenseValues(snapshot)
    authDebug('POS_EXPENSE_REMOTE_UPDATE', { count: expenses.length })
    const merged = cacheCentralExpenses(expenses)
    callback?.(merged)
  }, () => callback?.(readCachedExpenses()))
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
    const normalized = normalizeExpense(localExpense)
    if (!normalized.amount || !normalized.businessDate || !normalized.createdAt) {
      skipped += 1
      retainedPending.push({ ...normalized, id: expenseIdOf(normalized) || `expense-${crypto.randomUUID()}`, syncStatus: 'pending' })
      continue
    }
    if (centralExpenses.some(remote => areExpenseDuplicates(normalized, remote))) { skipped += 1; continue }
    const id = validExpenseId(expenseIdOf(normalized)) ? expenseIdOf(normalized) : `expense-${crypto.randomUUID()}`
    const payload = centralExpensePayload({ ...normalized, id }, user, { preserveCreatedAt: true })
    await set(ref(db, `pos101_expenses/${id}`), payload)
    centralExpenses.push(normalizeExpense(payload))
    uploaded += 1
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
  cacheCentralExpenses(readCachedExpenses().filter(row => expenseIdOf(row) !== id))
  return { id, deletedBy: user.uid }
}

// Product management is deliberately isolated from pos101_sales. Existing
// static menu records are never deleted or rewritten; this path contains only
// new products and explicit updates/hide/show overlays keyed by product ID.
export const isCentralProductReader = user => isCentralCashierUser(user) || isCentralAdminUser(user)
export const isCentralProductManager = user => isCentralProductReader(user)
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
  if (!configured || !db || !isCentralProductReader(auth?.currentUser)) return () => {}
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

