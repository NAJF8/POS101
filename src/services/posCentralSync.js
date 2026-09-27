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
const productionEnabled = env.VITE_POS101_ENABLE_PRODUCTION_SYNC === 'true'
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
export const CENTRAL_SYNC_EMAIL = '101cofeehouse@gmail.com'
const SYNC_ACTIVATED_AT_KEY = 'pos101.syncActivatedAt'
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

const mergeBySaleId = (localSales, centralSales) => {
  const merged = new Map()
  for (const sale of localSales) if (saleIdOf(sale)) merged.set(saleIdOf(sale), sale)
  for (const sale of centralSales) if (saleIdOf(sale) && !merged.has(saleIdOf(sale))) merged.set(saleIdOf(sale), sale)
  return [...merged.values()]
}

const readSyncActivatedAt = () => {
  const value = Number(localStorage.getItem(SYNC_ACTIVATED_AT_KEY))
  return Number.isFinite(value) && value > 0 ? value : null
}

const activationTimeForUser = user => {
  const existing = readSyncActivatedAt()
  if (existing) return existing
  const createdAt = Date.parse(user?.metadata?.creationTime || '')
  if (!Number.isFinite(createdAt) || createdAt <= 0) throw new Error('تعذر تحديد وقت تفعيل المزامنة من Firebase Auth.')
  localStorage.setItem(SYNC_ACTIVATED_AT_KEY, String(createdAt))
  return createdAt
}

const eligibleForUpload = (sale, syncActivatedAt) => {
  const createdAt = Number(sale?.createdAt)
  return Number.isFinite(createdAt) && createdAt >= syncActivatedAt
}

const serializeSale = sale => ({
  ...sale,
  saleId: saleIdOf(sale),
  id: saleIdOf(sale),
  source: 'POS101',
  source_channel: 'POS101',
  syncedAt: Date.now(),
})

const requireReady = async () => {
  if (!configured) throw Object.assign(new Error('إعداد Firebase المركزي غير موجود.'), { code: 'NOT_CONFIGURED' })
  if (!useEmulator && !productionEnabled) throw Object.assign(new Error('المزامنة المركزية للإنتاج متوقفة حتى اعتماد Auth وRules واختبار Production.'), { code: 'PRODUCTION_SYNC_DISABLED' })
  await authReady
  if (!auth?.currentUser) throw Object.assign(new Error('تسجيل دخول Firebase مطلوب للمزامنة.'), { code: 'AUTH_REQUIRED' })
  if (auth.currentUser.email !== CENTRAL_SYNC_EMAIL) {
    await signOut(auth)
    throw Object.assign(new Error(`حساب المزامنة المسموح به هو ${CENTRAL_SYNC_EMAIL} فقط.`), { code: 'UNAUTHORIZED_SYNC_EMAIL' })
  }
  activationTimeForUser(auth.currentUser)
}

export const isCentralConfigured = () => configured
export const isCentralEmulator = () => useEmulator
export const centralAuth = () => auth
export const subscribeCentralAuth = callback => auth ? onAuthStateChanged(auth, callback) : () => {}
export const signInCentralWithGoogle = async () => {
  if (!configured || !auth) throw new Error('إعداد Firebase المركزي غير موجود.')
  await authReady
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ login_hint: CENTRAL_SYNC_EMAIL })
  const result = await signInWithPopup(auth, provider)
  const user = result.user
  if (user.email !== CENTRAL_SYNC_EMAIL) {
    await signOut(auth)
    throw Object.assign(new Error(`حساب المزامنة المسموح به هو ${CENTRAL_SYNC_EMAIL} فقط.`), { code: 'UNAUTHORIZED_SYNC_EMAIL' })
  }
  return user
}
export const signOutCentral = () => auth ? signOut(auth) : Promise.resolve()

export const inspectLocalSales = () => {
  const sales = readSales().filter(sale => saleIdOf(sale))
  const latest = sales.slice().sort((a, b) => Number(b.orderNumber || 0) - Number(a.orderNumber || 0))[0]
  return { count: sales.length, latestOrderNumber: latest?.orderNumber ?? null, latestCreatedAt: latest?.createdAt ?? null }
}

export const setCentralSyncActivatedAt = user => ({ syncActivatedAt: activationTimeForUser(user || auth?.currentUser) })
export const getCentralSyncActivatedAt = () => ({ syncActivatedAt: readSyncActivatedAt() })

export const mergeCentralSalesLocally = centralSales => {
  const localSales = readSales()
  const merged = mergeBySaleId(localSales, centralSales)
  if (merged.length !== localSales.length) {
    writeSales(merged)
    dispatchUpdated()
  }
  return merged
}

export const syncCentralSales = async () => {
  await requireReady()
  const localSales = readSales()
  const before = await get(salesRef())
  const beforeCentral = centralValues(before)
  const centralIds = new Set(beforeCentral.map(saleIdOf))
  const syncActivatedAt = activationTimeForUser(auth.currentUser)
  const candidates = localSales.filter(sale => eligibleForUpload(sale, syncActivatedAt))
  const uploadable = candidates.filter(sale => !centralIds.has(saleIdOf(sale)) && saleIdOf(sale))
  let uploaded = 0
  for (const sale of uploadable) {
    const saleRef = ref(db, `pos101_sales/${saleIdOf(sale)}`)
    try {
      await set(saleRef, serializeSale(sale))
      uploaded += 1
    } catch (error) {
      // Another authorized device may have created the same sale concurrently.
      // Treat an identical read-back as idempotent; never overwrite it.
      const readBack = await get(saleRef)
      if (!readBack.exists() || saleIdOf(readBack.val()) !== saleIdOf(sale)) throw error
    }
  }

  const after = await get(salesRef())
  const afterCentral = centralValues(after)
  const merged = mergeBySaleId(localSales, afterCentral)
  writeSales(merged)
  dispatchUpdated()
  return {
    uploaded,
    received: afterCentral.filter(sale => !localSales.some(local => saleIdOf(local) === saleIdOf(sale))).length,
    centralCount: afterCentral.length,
    mergedCount: merged.length,
    localCount: localSales.length,
    syncActivatedAt,
    uploadBlocked: false,
  }
}

export const subscribeCentralSales = callback => {
  if (!configured || !db || !auth?.currentUser || (!useEmulator && !productionEnabled)) return () => {}
  return onValue(salesRef(), snapshot => {
    const centralSales = centralValues(snapshot)
    const merged = mergeCentralSalesLocally(centralSales)
    callback({ centralCount: centralSales.length, mergedCount: merged.length })
  }, () => {})
}

