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
  set,
} from 'firebase/database'

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
let app = null
let auth = null
let db = null
let authReady = Promise.resolve()

if (configured) {
  app = getApps().find(item => item.name === 'pos101-central') || initializeApp(config, 'pos101-central')
  auth = getAuth(app)
  db = getDatabase(app)
  authReady = setPersistence(auth, browserLocalPersistence).catch(() => {})
  if (useEmulator) {
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true })
    connectDatabaseEmulator(db, emulatorHost, 9000)
  }
}

const SALES_KEY = 'pos101.sales'
const CASHIER_LOGIN_HINT_EMAIL = '101cofeehouse@gmail.com'
export const CENTRAL_SYNC_UID = '4Tx0bMygd8gVuDDDOblnt3HOvo72'
export const ADMIN_UID = 'rtDA9erW11geHfLpa3ZW3LacZR73'
export const ADMIN_EMAIL = 'mohameadalhaear100@gmail.com'
const INITIAL_SYNC_COMPLETED_KEY = 'pos101.initialSyncCompleted'
const salesRef = () => ref(db, 'pos101_sales')
const saleIdOf = sale => String(sale?.saleId || sale?.id || '').trim()
const readSales = () => {
  try {
    const value = JSON.parse(localStorage.getItem(SALES_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}
const writeSales = sales => localStorage.setItem(SALES_KEY, JSON.stringify(sales))
const dispatchUpdated = () => window.dispatchEvent(new CustomEvent('pos101-sales-updated'))

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

const requireReady = async () => {
  if (!configured) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  await authReady
  if (!auth?.currentUser) throw Object.assign(new Error('تسجيل دخول Firebase مطلوب للمزامنة.'), { code: 'AUTH_REQUIRED' })
  if (getCentralRole(auth.currentUser) !== 'cashier-sync') {
    await signOut(auth)
    throw Object.assign(new Error('هذا الحساب لا يملك صلاحية رفع المبيعات.'), { code: 'CENTRAL_WRITE_BLOCKED' })
  }
}

export const isCentralConfigured = () => configured
export const isCentralEmulator = () => useEmulator
export const centralAuth = () => auth
export const subscribeCentralAuth = callback => auth ? onAuthStateChanged(auth, callback) : () => {}
export const getCentralRole = user => user?.uid === CENTRAL_SYNC_UID ? 'cashier-sync' : user?.uid === ADMIN_UID ? 'admin-viewer' : 'blocked'
export const getCentralPermissions = user => {
  const role = getCentralRole(user)
  return role === 'cashier-sync'
    ? { centralRead: true, centralWrite: true, uploadLocalSales: true, autoUpload: true, realtimeRead: true, downloadMerge: true }
    : role === 'admin-viewer'
      ? { centralRead: true, centralWrite: false, uploadLocalSales: false, autoUpload: false, realtimeRead: true, downloadMerge: true }
      : { centralRead: false, centralWrite: false, uploadLocalSales: false, autoUpload: false, realtimeRead: false, downloadMerge: false }
}
export const isCentralCashierUser = user => getCentralRole(user) === 'cashier-sync'
export const isCentralAdminUser = user => getCentralRole(user) === 'admin-viewer'
export const signInCentralWithGoogle = async () => {
  if (!configured || !auth) throw new Error('إعداد Firebase المركزي غير موجود.')
  await authReady
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ login_hint: CASHIER_LOGIN_HINT_EMAIL })
  const result = await signInWithPopup(auth, provider)
  const user = result.user
  if (!isCentralCashierUser(user)) {
    await signOut(auth)
    throw Object.assign(new Error('هذا الحساب لا يملك صلاحية رفع المبيعات.'), { code: 'CENTRAL_WRITE_BLOCKED' })
  }
  return user
}
export const signInAdminWithGoogle = async () => {
  if (!configured || !auth) throw new Error('إعداد Firebase المركزي غير موجود.')
  await authReady
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const result = await signInWithPopup(auth, provider)
  if (!isCentralAdminUser(result.user)) {
    await signOut(auth)
    throw Object.assign(new Error('الحساب الإداري المحدد غير مطابق. اختر حساب الإدارة الصحيح.'), { code: 'UNAUTHORIZED_ADMIN_ACCOUNT' })
  }
  return result.user
}
export const signOutCentral = () => auth ? signOut(auth) : Promise.resolve()

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

export const syncCentralSales = async ({ initial = false } = {}) => {
  await requireReady()
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

export const subscribeCentralSales = callback => {
  if (!configured || !db || !isCentralCashierUser(auth?.currentUser)) return () => {}
  return onValue(salesRef(), snapshot => {
    const centralSales = centralValues(snapshot)
    const merged = mergeCentralSalesLocally(centralSales)
    callback({ centralCount: centralSales.length, mergedCount: merged.length })
  }, () => {})
}

export const subscribeCentralSalesReadOnly = callback => {
  if (!configured || !db || !isCentralAdminUser(auth?.currentUser)) return () => {}
  return onValue(salesRef(), snapshot => {
    callback(centralValues(snapshot))
  }, () => {})
}

export const readCentralSalesReadOnly = async () => {
  if (!configured || !db || !isCentralAdminUser(auth?.currentUser)) throw new Error('تسجيل دخول الإدارة مطلوب للقراءة.')
  const snapshot = await get(salesRef())
  return centralValues(snapshot)
}

