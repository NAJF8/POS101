import { initializeApp, getApps } from 'firebase/app'
import {
  getAuth,
  browserLocalPersistence,
  connectAuthEmulator,
  onAuthStateChanged,
  setPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import {
  getDatabase,
  connectDatabaseEmulator,
  get,
  onValue,
  push,
  ref,
  runTransaction,
  set,
  update,
} from 'firebase/database'
import {
  markSaleSynced,
  readSaleQueue,
  reconcileSalesAgainstCentral,
  retainQueuedSale,
} from './salesSyncQueue.js'

const env = import.meta.env || {}
const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
const useEmulator = env.DEV && env.VITE_USE_FIREBASE_EMULATOR === 'true' && isLocalHost
const emulatorHost = env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1'
const emulatorProjectId = env.VITE_FIREBASE_EMULATOR_PROJECT_ID || 'acc-101-pos-emulator'
const firebaseConfig = {
  apiKey: useEmulator ? 'local-emulator-api-key' : env.VITE_FIREBASE_API_KEY,
  authDomain: useEmulator ? `${emulatorProjectId}.firebaseapp.com` : env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: useEmulator ? emulatorProjectId : env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: useEmulator ? `${emulatorProjectId}.appspot.com` : env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: useEmulator ? 'local-emulator-sender' : env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: useEmulator ? 'local-emulator-app' : env.VITE_FIREBASE_APP_ID,
  databaseURL: useEmulator ? `http://${emulatorHost}:9000?ns=${emulatorProjectId}-default-rtdb` : env.VITE_FIREBASE_DATABASE_URL,
}

let configured = Boolean(firebaseConfig.apiKey && firebaseConfig.messagingSenderId && firebaseConfig.appId)
let app = null
let auth = null
let db = null
let authPersistenceReady = Promise.resolve()
if (configured) {
  app = getApps().find(item => item.name === 'pos101-acc') || initializeApp(firebaseConfig, 'pos101-acc')
  auth = getAuth(app)
  authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {})
  db = getDatabase(app)
  if (useEmulator) {
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true })
    connectDatabaseEmulator(db, emulatorHost, 9000)
  }
}

const ensureConfigured = () => {
  if (!configured || !auth || !db) throw new Error('┘ä┘à ┘è╪¬┘à ╪Ñ╪╣╪»╪º╪» ╪º╪¬╪╡╪º┘ä ACC-101 ┘ä┘ç╪░╪º ╪º┘ä╪¿┘å╪º╪í. ╪ú╪╢┘ü ╪Ñ╪╣╪»╪º╪»╪º╪¬ Firebase ╪½┘à ╪ú╪╣╪» ╪º┘ä╪¿┘å╪º╪í.')
}

const cleanKey = value => String(value || '').split('').map(character => '.#$[]/'.includes(character) ? '_' : character).join('')
const authEmailKey = email => cleanKey(String(email || '').trim().toLowerCase())
const todayBaghdad = () => new Intl.DateTimeFormat('en-CA', { numberingSystem: 'latn', timeZone: 'Asia/Baghdad' }).format(new Date())
const monthOf = date => String(date || todayBaghdad()).slice(0, 7)
const normalize = value => String(value || '').trim().toLowerCase().replace(/[┘ï┘î┘ì┘Ä┘Å┘É┘æ┘Æ┘Ç]/g, '').replace(/[╪Ñ╪ú╪ó]/g, '╪º').replace(/┘ë/g, '┘è').replace(/\s+/g, ' ')
const values = snapshot => snapshot.exists() ? Object.entries(snapshot.val()).map(([id, value]) => ({ id, ...value })) : []
const saleFingerprint = sale => JSON.stringify({
  items: (sale.items || []).map(item => ({ product_id: item.accProductId || item.product_id || item.id, quantity: Number(item.quantity || 0), unit_price: Number(item.price || 0) })),
  subtotal: Number(sale.subtotal || 0), discount: Number(sale.discount || 0), total: Number(sale.total || 0), payment_method: sale.paymentMethod || ''
})
const roundInventory = value => Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000
const locationBalances = item => item?.location_quantities && typeof item.location_quantities === 'object' ? { ...item.location_quantities } : { main_storage: Number(item?.quantity ?? 0) }
const toBaseQuantity = ({ quantity, unit, baseUnit, conversionFactor = 1 }) => {
  const qty = Number(quantity), factor = Number(conversionFactor)
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(factor) || factor <= 0) throw new Error('كمية أو معامل تحويل غير صالح.')
  if (unit === baseUnit) return qty
  if ((unit === 'L' && baseUnit === 'ml') || (unit === 'kg' && baseUnit === 'g')) return qty * 1000
  if (['bottle', 'box', 'carton', 'pack', 'bag', 'piece'].includes(unit)) return qty * factor
  throw new Error(`لا يمكن تحويل ${unit} إلى ${baseUnit} بدون معامل تحويل واضح.`)
}
const weightedAverageCost = ({ oldQuantity, oldUnitCost, addedQuantity, addedTotalCost }) => {
  const before = Number(oldQuantity), oldCost = Number(oldUnitCost), added = Number(addedQuantity), addedCost = Number(addedTotalCost)
  if ([before, oldCost, added, addedCost].some(value => !Number.isFinite(value) || value < 0) || before + added <= 0) throw new Error('مدخلات متوسط التكلفة غير صالحة.')
  return (before * oldCost + addedCost) / (before + added)
}

export const isAccConfigured = () => configured
export const isAccEmulator = () => useEmulator
export const accAuth = () => auth
const waitForAuthUser = async () => {
  await authPersistenceReady
  if (auth.currentUser) return auth.currentUser
  return new Promise(resolve => {
    let unsubscribe = () => {}
    const timeout = window.setTimeout(() => {
      unsubscribe()
      resolve(null)
    }, 5000)
    unsubscribe = onAuthStateChanged(auth, user => {
      if (!user) return
      window.clearTimeout(timeout)
      unsubscribe()
      resolve(user)
    })
  })
}
export const subscribeAuth = callback => {
  if (!configured) return () => {}
  return onAuthStateChanged(auth, callback)
}

export async function verifyPosCashier(user = auth?.currentUser) {
  ensureConfigured()
  if (!user?.uid) throw Object.assign(new Error('تسجيل الدخول إلى Google مطلوب للمزامنة.'), { code: 'UNAUTHENTICATED' })
  const profileSnap = await get(ref(db, `users/${user.uid}`))
  const profile = profileSnap.exists() ? profileSnap.val() : null
  const authorizedSnap = await get(ref(db, `authorized_users/${authEmailKey(user.email)}`))
  const authorized = authorizedSnap.exists() ? authorizedSnap.val() : null
  const allowed = profile?.id === user.uid
    && profile?.active !== false
    && profile?.role === 'pos_cashier'
    && profile?.permissions?.pos?.sales_create === true
    && authorized?.uid === user.uid
    && authorized?.active !== false
    && authorized?.role === 'pos_cashier'
    && (authorized?.permissions?.pos_sales_create === true || authorized?.permissions_rules?.pos?.sales_create === true || authorized?.permissions?.pos?.sales_create === true)
  if (!allowed) {
    await signOut(auth).catch(() => {})
    throw Object.assign(new Error('حساب Google غير مصرح لـ POS.'), { code: 'PERMISSION_DENIED' })
  }
  return { ...profile, id: user.uid, email: user.email }
}

export async function signInToAccWithGoogle() {
  ensureConfigured()
  await authPersistenceReady
  const credential = await signInWithPopup(auth, new GoogleAuthProvider())
  return verifyPosCashier(credential.user)
}

export async function logoutFromAcc() {
  if (auth) await signOut(auth)
}

export async function loadAccProducts() {
  ensureConfigured()
  const [productsSnapshot, categoriesSnapshot] = await Promise.all([
    get(ref(db, 'products')),
    get(ref(db, 'product_categories')).catch(() => null),
  ])
  const categoryById = new Map(values(categoriesSnapshot).map(item => [String(item.id), item.name_ar || item.nameAr || item.name || '']))
  return values(productsSnapshot).filter(item => item.active !== false).map(item => ({
    ...item,
    accProductId: item.id,
    name: item.name_ar || item.nameAr || item.name || '',
    english: item.name_en || item.nameEn || '',
    price: Number(item.selling_price ?? item.sellingPrice ?? 0),
    category: item.category_name_ar || item.category_name || categoryById.get(String(item.category_id)) || item.category || '╪║┘è╪▒ ┘à╪╡┘å┘ü',
    image: item.image_url || item.imageUrl || item.image || null,
    unavailable: item.active === false,
  }))
}

const normalizeSaleTimestamp = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 100000000000 ? numeric * 1000 : numeric
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeRemoteSale = (sale, fallbackId) => {
  const id = String(sale.saleId || sale.sale_id || sale.id || fallbackId || '').trim()
  const remoteItems = Array.isArray(sale.items) ? sale.items : Object.values(sale.items || {})
  return {
    ...sale,
    id,
    saleId: id,
    orderNumber: sale.orderNumber ?? sale.order_number ?? sale.order_no ?? sale.number ?? id,
    createdAt: normalizeSaleTimestamp(sale.createdAt ?? sale.created_at ?? sale.timestamp ?? sale.date),
    paymentMethod: sale.paymentMethod || sale.payment_method || 'unknown',
    subtotal: Number(sale.subtotal ?? 0),
    discount: Number(sale.discount ?? sale.discount_amount ?? 0),
    total: Number(sale.total ?? sale.total_after_discount ?? sale.total_amount ?? 0),
    status: sale.status === 'voided' || sale.voided === true ? 'voided' : (sale.status || 'completed'),
    items: remoteItems.map((item, index) => ({
      ...item,
      id: item.id || item.product_id || `remote-${index}`,
      name: item.name || item.product_name || item.item_name || '',
      english: item.english || item.product_name_en || '',
      quantity: Number(item.quantity || 0),
      price: Number(item.price ?? item.unit_price ?? 0),
    })),
  }
}

// Read-only central history. No service account and no Firebase writes.
export async function loadAccSales() {
  ensureConfigured()
  const snapshot = await get(ref(db, 'sales'))
  return values(snapshot)
    .filter(row => !row.source_channel || row.source_channel === 'POS101')
    .map(row => normalizeRemoteSale(row, row.id))
    .filter(row => row.id)
}

// The queue is reconciled by readback before any create call. This is the
// safety gate for browsers that already contain imported historical sales.
export async function syncSalesQueue(profile) {
  ensureConfigured()
  const centralSales = await loadAccSales()
  const reconciliation = reconcileSalesAgainstCentral(centralSales)
  let uploaded = 0
  let failed = 0
  for (const entry of readSaleQueue()) {
    try {
      await saveAccSale(entry.sale, profile)
      markSaleSynced(entry.sale)
      uploaded += 1
    } catch (error) {
      retainQueuedSale(entry, error)
      failed += 1
    }
  }
  return {
    centralCount: centralSales.length,
    reconciled: reconciliation.reconciled,
    uploaded,
    failed,
    pending: readSaleQueue().length,
  }
}

const claimOperation = async (key, payload) => {
  const result = await runTransaction(ref(db, `sales_operations/${key}`), current => current || payload)
  return { committed: result.committed, value: result.snapshot.val() }
}

async function consumeRecipe(productId, quantity, sourceKey, userId, date) {
  const recipeSnap = await get(ref(db, `product_recipes/${productId}`))
  const recipe = recipeSnap.exists() ? recipeSnap.val() : null
  if (!recipe?.items?.length) return false
  for (const line of recipe.items) {
    const itemId = line.inventory_item_id
    const operationId = cleanKey(`pos101:${sourceKey}:${productId}:${itemId}`)
    const itemSnap = await get(ref(db, `inventory_items/${itemId}`))
    if (!itemSnap.exists()) throw new Error('┘à╪º╪»╪⌐ ┘ê╪╡┘ü╪⌐ ╪║┘è╪▒ ┘à┘ê╪¼┘ê╪»╪⌐ ┘ü┘è ╪º┘ä┘à╪«╪▓┘ê┘å.')
    const item = itemSnap.val()
    const required = Number(line.quantity || 0) * Number(quantity || 0) * Number(line.conversion_factor || 1)
    if (!Number.isFinite(required) || required <= 0) throw new Error('┘â┘à┘è╪⌐ ┘ê╪╡┘ü╪⌐ ╪║┘è╪▒ ╪╡╪¡┘è╪¡╪⌐.')
    const opRef = ref(db, `inventory_operations/${operationId}`)
    const opClaim = await runTransaction(opRef, current => current || {
      id: operationId, source_type: 'sale', source_key: `sale:${sourceKey}`, operation_key: sourceKey,
      product_id: productId, item_id: itemId, quantity: required, status: 'pending', created_at: new Date().toISOString(), created_by: userId,
    })
    const op = opClaim.snapshot.val()
    if (op?.status === 'completed') continue
    const quantityRef = ref(db, `inventory_items/${itemId}/quantity`)
    const beforeSnap = await get(quantityRef)
    const before = Number(beforeSnap.val() ?? item.quantity ?? item.current_stock ?? 0)
    let after = Number(op?.after_quantity)
    const recordedBefore = Number(op?.before_quantity)
    const recordedAfter = Number(op?.after_quantity)
    const stockAlreadyApplied = Number.isFinite(recordedBefore) && Number.isFinite(recordedAfter) && before === recordedAfter && recordedAfter === recordedBefore - required
    if (stockAlreadyApplied) {
      after = recordedAfter
    } else {
      if (Number.isFinite(recordedBefore) && Number.isFinite(recordedAfter) && before !== recordedBefore) throw new Error('╪¬╪╣╪º╪▒╪╢ ┘ü┘è ╪▒╪╡┘è╪» ┘à╪º╪»╪⌐ ╪º┘ä┘ê╪╡┘ü╪⌐ ╪ú╪½┘å╪º╪í ╪º╪│╪¬╪ª┘å╪º┘ü ╪º┘ä╪╣┘à┘ä┘è╪⌐.')
      if (before < required) throw new Error(`╪º┘ä┘à╪«╪▓┘ê┘å ┘ä╪º ┘è┘â┘ü┘è ┘ä┘à╪º╪»╪⌐ ╪º┘ä┘ê╪╡┘ü╪⌐: ${item.name_ar || item.name || itemId}`)
      await update(ref(db), { [`inventory_items/${itemId}/inventory_operation_id`]: operationId })
      const quantityTxn = await runTransaction(quantityRef, current => {
        // RTDB may invoke a transaction once with a null local cache before
        // supplying the server value. Do not turn that transient state into a
        // false insufficient-stock result.
        const currentNumber = current === null ? before : Number(current)
        return currentNumber >= required ? currentNumber - required : undefined
      })
      if (!quantityTxn.committed) throw new Error('╪¬╪╣╪░╪▒ ╪¬╪½╪¿┘è╪¬ ╪«╪╡┘à ╪º┘ä┘à╪«╪▓┘ê┘å ╪¿╪│╪¿╪¿ ╪¬╪╣╪º╪▒╪╢ ┘à╪¬╪▓╪º┘à┘å.')
      after = Number(quantityTxn.snapshot.val())
      await update(ref(db), { [`inventory_operations/${operationId}/before_quantity`]: before, [`inventory_operations/${operationId}/after_quantity`]: after })
    }
    const movementId = cleanKey(`${operationId}:movement`)
    await update(ref(db), {
      [`inventory_movements/${movementId}`]: {
        id: movementId, type: 'recipe_consumption', source_type: 'sale', source_id: sourceKey, source_key: `sale:${sourceKey}`,
        operation_id: operationId, product_id: productId, item_id: itemId, quantity_delta: -required,
        before_quantity: before, after_quantity: after, date, month: monthOf(date), created_at: new Date().toISOString(), created_by: userId,
      },
      [`inventory_operations/${operationId}/status`]: 'completed',
      [`inventory_operations/${operationId}/completed_at`]: new Date().toISOString(),
    })
  }
  return true
}

async function legacySaveAccSale(sale, profile) {
  ensureConfigured()
  const user = auth.currentUser
  if (!user || !profile?.id) throw new Error('╪º┘å╪¬┘ç╪¬ ╪¼┘ä╪│╪⌐ ╪º┘ä┘â╪º╪┤┘è╪▒. ╪│╪¼┘æ┘ä ╪º┘ä╪»╪«┘ê┘ä ┘à╪¼╪»╪»╪º┘ï.')
  const date = todayBaghdad()
  // Retries must reuse the exact key stored with the local sale. Older local
  // records without it retain the historical deterministic fallback.
  const operationKey = cleanKey(sale.operationKey || `pos101:${sale.saleId || sale.id}`)
  const fingerprint = saleFingerprint(sale)
  const saleId = cleanKey(sale.saleId || sale.id)
  if (!saleId) throw new Error('┘à╪╣╪▒┘ü ╪¿┘è╪╣ ┘à╪¡┘ä┘è ╪½╪º╪¿╪¬ ┘à╪╖┘ä┘ê╪¿ ┘é╪¿┘ä ╪º┘ä╪Ñ╪▒╪│╪º┘ä.')
  const operation = await claimOperation(operationKey, {
    id: operationKey, operation_key: operationKey, source_type: 'sale', sale_id: saleId, fingerprint, status: 'pending', created_at: new Date().toISOString(), created_by: user.uid,
  })
  if (!operation.committed && operation.value?.fingerprint && operation.value.fingerprint !== fingerprint) {
    throw Object.assign(new Error('╪¬╪╣╪º╪▒╪╢ ┘ü┘è operation_key: ╪º┘ä┘à┘ü╪¬╪º╪¡ ┘à╪│╪¬╪«╪»┘à ┘ä┘à╪¡╪¬┘ê┘ë ╪¿┘è╪╣ ┘à╪«╪¬┘ä┘ü.'), { code: 'OPERATION_KEY_CONFLICT' })
  }
  const canonicalSaleId = cleanKey(operation.value?.sale_id || saleId)
  const remoteItems = sale.items.map(item => ({
    product_id: item.accProductId || item.product_id || item.id,
    product_name: item.name,
    item_name: item.name,
    quantity: Number(item.quantity || 0),
    unit: item.unit || 'piece',
    unit_price: Number(item.price || 0),
  }))
  const record = {
    id: saleId, source_channel: 'POS101', source_operation_key: operationKey, operation_key: operationKey,
    date, month: monthOf(date), payment_method: sale.paymentMethod, subtotal: Number(sale.subtotal || 0),
    discount_amount: Number(sale.discount || 0), total_after_discount: Number(sale.total || 0),
    items: remoteItems, cashier_uid: user.uid, cashier_name: profile.name || '', shift_id: sale.cashierId || '',
    created_at: new Date().toISOString(), created_by: user.uid, created_by_name: profile.name || '',
  }
  // A cashier is allowed to read an existing sale it owns, but a missing
  // sale is also a valid recovery state immediately after the operation claim.
  const existingSale = await get(ref(db, `sales/${canonicalSaleId}`)).catch(() => null)
  if (existingSale?.exists() && existingSale.val()?.operation_key && existingSale.val().operation_key !== operationKey) {
    throw Object.assign(new Error('┘à╪╣╪▒┘ü ╪º┘ä╪¿┘è╪╣ ╪º┘ä┘à╪¡┘ä┘è ┘à╪│╪¬╪«╪»┘à ┘ä╪╣┘à┘ä┘è╪⌐ ┘à╪«╪¬┘ä┘ü╪⌐.'), { code: 'SALE_ID_CONFLICT' })
  }
  if (operation.value?.status === 'completed') return { ...(existingSale?.val() || record), already_processed: true, operation_key: operationKey }
  await update(ref(db), { [`sales/${canonicalSaleId}`]: { ...record, id: canonicalSaleId }, [`sales_operations/${operationKey}/sale_id`]: canonicalSaleId, [`sales_operations/${operationKey}/fingerprint`]: fingerprint })
  try {
    let recipeFound = false
    for (const item of remoteItems) recipeFound = (await consumeRecipe(item.product_id, item.quantity, operationKey, user.uid, date)) || recipeFound
    await update(ref(db), { [`sales_operations/${operationKey}/status`]: 'completed', [`sales_operations/${operationKey}/completed_at`]: new Date().toISOString(), [`sales/${canonicalSaleId}/inventory_consumption_status`]: recipeFound ? 'completed' : 'no_recipe' })
  } catch (error) {
    await update(ref(db), { [`sales_operations/${operationKey}/status`]: 'failed', [`sales_operations/${operationKey}/failed_at`]: new Date().toISOString(), [`sales/${canonicalSaleId}/inventory_consumption_status`]: 'needs_review', [`sales/${canonicalSaleId}/inventory_consumption_error`]: String(error.message || error) })
    throw error
  }
  return { ...record, id: canonicalSaleId, already_processed: false }
}

export async function saveAccSale(sale, profile) {
  ensureConfigured()
  const user = await waitForAuthUser()
  if (!user || !profile?.id || user.uid !== profile.id) throw Object.assign(new Error('جلسة Google غير صالحة للمزامنة.'), { code: 'UNAUTHENTICATED' })
  const verified = await verifyPosCashier(user)
  const sourceId = String(sale.saleId || sale.id || '').trim()
  if (!sourceId) throw new Error('معرف المبيعة مطلوب للمزامنة.')
  const integrationKey = `POS101:sale:${sourceId}`
  const candidateIds = [sourceId, `pos101_${cleanKey(sourceId)}`]
  let existing = null
  for (const candidateId of candidateIds) {
    const snapshot = await get(ref(db, `sales/${candidateId}`)).catch(() => null)
    if (snapshot?.exists() && (snapshot.val().integrationKey === integrationKey || snapshot.val().sourceId === sourceId || snapshot.val().source_sale_id === sourceId)) { existing = { ...snapshot.val(), id: candidateId }; break }
  }
  const id = existing?.id || candidateIds[1]
  const now = new Date().toISOString()
  const record = {
    ...(existing || {}), id, source: 'POS101', sourceType: 'sale', sourceId, integrationKey,
    source_channel: 'POS101', source_type: 'sale', source_sale_id: sourceId,
    source_operation_key: sale.operationKey || sale.operation_key || `pos101:${sourceId}`,
    operation_key: sale.operationKey || sale.operation_key || `pos101:${sourceId}`,
    businessDate: sale.businessDate || sale.business_date || null,
    businessDateStatus: sale.businessDate || sale.business_date ? 'resolved' : 'manual_required',
    date: sale.businessDate || sale.business_date || null,
    month: monthOf(sale.businessDate || sale.business_date),
    orderNumber: sale.orderNumber ?? sale.order_number ?? '',
    createdAt: sale.createdAt ?? sale.created_at ?? existing?.createdAt ?? now,
    updatedAt: sale.updatedAt ?? sale.updated_at ?? now,
    created_at: sale.createdAt ?? sale.created_at ?? existing?.created_at ?? now,
    updated_at: sale.updatedAt ?? sale.updated_at ?? now,
    cashierId: sale.cashierId ?? sale.cashier_id ?? '', cashier_id: sale.cashierId ?? sale.cashier_id ?? '',
    cashierName: sale.cashierName ?? sale.cashier_name ?? '', cashier_name: sale.cashierName ?? sale.cashier_name ?? '',
    shiftId: sale.shiftId ?? sale.shift_id ?? sale.operationalDayId ?? '', shift_id: sale.shiftId ?? sale.shift_id ?? sale.operationalDayId ?? '',
    deviceId: sale.deviceId ?? sale.device_id ?? '', device_id: sale.deviceId ?? sale.device_id ?? '',
    orderType: sale.orderType ?? sale.order_type ?? '', order_type: sale.orderType ?? sale.order_type ?? '',
    status: sale.status || existing?.status || 'completed',
    subtotal: Number(sale.subtotal || 0), discountAmount: Number(sale.discount ?? sale.discountAmount ?? 0),
    discount_amount: Number(sale.discount ?? sale.discountAmount ?? 0), discount: Number(sale.discount ?? sale.discountAmount ?? 0),
    total: Number(sale.total ?? sale.subtotal ?? 0), total_after_discount: Number(sale.total ?? sale.subtotal ?? 0),
    paymentMethod: sale.paymentMethod || sale.payment_method || 'cash', payment_method: sale.paymentMethod || sale.payment_method || 'cash',
    items: (sale.items || []).map(item => ({ ...item, productId: item.accProductId || item.product_id || item.id, product_id: item.accProductId || item.product_id || item.id, quantity: Number(item.quantity || 0), unitPrice: Number(item.price || item.unit_price || 0), unit_price: Number(item.price || item.unit_price || 0) })),
    created_by: verified.id, syncVersion: Number(existing?.syncVersion || 0) + 1,
  }
  await set(ref(db, `sales/${id}`), record)
  const back = await get(ref(db, `sales/${id}`))
  if (!back.exists() || back.val().integrationKey !== integrationKey) throw Object.assign(new Error('ACC sale read-back failed.'), { code: 'ACC_SALE_READBACK_FAILED' })
  return { ...back.val(), id, alreadyProcessed: Boolean(existing) }
}

export async function saveAccExpense(expense, profile) {
  ensureConfigured()
  const user = await waitForAuthUser()
  if (!user || !profile?.id || user.uid !== profile.id) throw Object.assign(new Error('انتهت جلسة الكاشير. سجّل الدخول مجدداً.'), { code: 'UNAUTHENTICATED' })
  const verified = await verifyPosCashier(user)
  const sourceId = String(expense.id || expense.expenseId || '').trim()
  if (!sourceId) throw new Error('معرف المصروف مطلوب للمزامنة.')
  return writeAccExpense(expense, verified, sourceId, 'active')
}

export async function updateAccExpense(expense, profile) {
  return saveAccExpense(expense, profile)
}

export async function voidAccExpense(expense, profile) {
  return saveAccExpense({ ...expense, status: 'voided' }, profile)
}

async function writeAccExpense(expense, verified, sourceId, status) {
  const integrationKey = `POS101:expense:${sourceId}`
  const candidateIds = [sourceId, `pos101:${cleanKey(sourceId)}`, `pos101_${cleanKey(sourceId)}`]
  let existing = null
  for (const candidateId of candidateIds) {
    const snapshot = await get(ref(db, `expenses/${candidateId}`)).catch(() => null)
    if (snapshot?.exists() && (snapshot.val().integrationKey === integrationKey || snapshot.val().sourceId === sourceId || snapshot.val().source_expense_id === sourceId)) { existing = { ...snapshot.val(), id: candidateId }; break }
  }
  const id = existing?.id || candidateIds[2]
  const now = new Date().toISOString()
  const record = { ...(existing || {}), id, source: 'POS101', sourceType: 'expense', sourceId, integrationKey, source_channel: 'POS101', source_type: 'expense', source_expense_id: sourceId, businessDate: expense.businessDate || expense.business_date || null, date: expense.businessDate || expense.business_date || null, month: monthOf(expense.businessDate || expense.business_date), amount: Number(expense.amount || 0), category: expense.category || existing?.category || 'أخرى', description: expense.description || expense.notes || expense.category || existing?.description || 'مصروف POS', paymentMethod: expense.paymentMethod || expense.payment_method || 'cash', payment_method: expense.paymentMethod || expense.payment_method || 'cash', status, createdAt: expense.createdAt ?? expense.created_at ?? existing?.createdAt ?? now, updatedAt: expense.updatedAt ?? expense.updated_at ?? now, created_by: verified.id, syncVersion: Number(existing?.syncVersion || 0) + 1 }
  await set(ref(db, `expenses/${id}`), record)
  const back = await get(ref(db, `expenses/${id}`))
  if (!back.exists() || back.val().integrationKey !== integrationKey) throw Object.assign(new Error('ACC expense read-back failed.'), { code: 'ACC_EXPENSE_READBACK_FAILED' })
  return { ...back.val(), id }
}

export async function getAccCashierProfile() {
  ensureConfigured()
  const user = await waitForAuthUser()
  return user ? verifyPosCashier(user) : null
}

const ACC_EXPENSE_QUEUE_KEY = 'pos101.accExpenseSyncQueue'
const readAccExpenseQueue = () => { try { const value = JSON.parse(localStorage.getItem(ACC_EXPENSE_QUEUE_KEY) || '[]'); return Array.isArray(value) ? value : [] } catch { return [] } }
const writeAccExpenseQueue = queue => localStorage.setItem(ACC_EXPENSE_QUEUE_KEY, JSON.stringify(queue))
export async function syncAccExpenseBestEffort(expense, action = 'upsert') {
  const queue = readAccExpenseQueue().filter(item => item.id !== String(expense?.id || ''))
  try {
    const profile = await getAccCashierProfile()
    if (!profile) throw Object.assign(new Error('ACC session unavailable.'), { code: 'ACC_AUTH_REQUIRED' })
    const result = action === 'void' ? await voidAccExpense(expense, profile) : await (expense?.updatedAt ? updateAccExpense(expense, profile) : saveAccExpense(expense, profile))
    writeAccExpenseQueue(queue)
    return result
  } catch (error) {
    writeAccExpenseQueue([...queue, { id: String(expense?.id || ''), expense, action, queuedAt: Date.now(), error: error?.code || 'UNKNOWN' }].filter(item => item.id))
    return { queued: true, code: error?.code || 'ACC_SYNC_PENDING' }
  }
}

export async function retryAccExpenseQueue() {
  const queue = readAccExpenseQueue()
  let synced = 0
  for (const item of queue) {
    const result = await syncAccExpenseBestEffort(item.expense, item.action)
    if (!result?.queued) synced += 1
  }
  return { synced, pending: readAccExpenseQueue().length }
}

const ACC_SALE_QUEUE_KEY = 'pos101.accSaleSyncQueue'
const readAccSaleQueue = () => { try { const value = JSON.parse(localStorage.getItem(ACC_SALE_QUEUE_KEY) || '[]'); return Array.isArray(value) ? value : [] } catch { return [] } }
const writeAccSaleQueue = queue => localStorage.setItem(ACC_SALE_QUEUE_KEY, JSON.stringify(queue))
export async function syncAccSaleBestEffort(sale) {
  const id = String(sale?.saleId || sale?.id || '')
  const queue = readAccSaleQueue().filter(item => item.id !== id)
  try {
    const profile = await getAccCashierProfile()
    if (!profile) throw Object.assign(new Error('ACC session unavailable.'), { code: 'ACC_AUTH_REQUIRED' })
    const result = await saveAccSale(sale, profile)
    writeAccSaleQueue(queue)
    return result
  } catch (error) {
    if (id) writeAccSaleQueue([...queue, { id, sale, queuedAt: Date.now(), error: error?.code || 'UNKNOWN' }])
    return { queued: true, code: error?.code || 'ACC_SYNC_PENDING' }
  }
}
export async function retryAccSaleQueue() {
  const queue = readAccSaleQueue()
  let synced = 0
  for (const item of queue) {
    const result = await syncAccSaleBestEffort(item.sale)
    if (!result?.queued) synced += 1
  }
  return { synced, pending: readAccSaleQueue().length }
}

export async function loadAccPurchaseCatalog() {
  ensureConfigured()
  const [inventorySnapshot, suppliersSnapshot] = await Promise.all([get(ref(db, 'inventory_items')), get(ref(db, 'suppliers'))])
  return {
    inventory: values(inventorySnapshot).filter(item => item.active !== false),
    suppliers: values(suppliersSnapshot).filter(item => item.active !== false),
  }
}

export async function saveAccPurchase(purchase, profile) {
  throw Object.assign(new Error('ACC direct purchase sync is intentionally disabled; no Cloud Functions path is available.'), { code: 'ACC_PURCHASE_SYNC_DISABLED' })
}


export async function openAccShift(profile, openingCash = 0, note = '') {
  ensureConfigured()
  const user = auth.currentUser
  const indexRef = ref(db, `cashier_open_shifts/${user.uid}`)
  const indexed = await get(indexRef)
  if (indexed.exists()) {
    const existing = await get(ref(db, `cashier_shifts/${indexed.val().shift_id}`))
    if (existing.exists() && existing.val().status === 'open') return existing.val()
    await set(indexRef, null)
  }
  const shiftRef = push(ref(db, 'cashier_shifts'))
  const record = { id: shiftRef.key, cashier_uid: user.uid, cashier_name: profile.name || '', opened_at: new Date().toISOString(), opening_cash: Number(openingCash), status: 'open', note, month: monthOf(), created_by: user.uid }
  const claim = await runTransaction(indexRef, current => current || { shift_id: shiftRef.key, cashier_uid: user.uid, created_at: new Date().toISOString() })
  if (!claim.committed) {
    const existing = await get(ref(db, `cashier_shifts/${claim.snapshot.val().shift_id}`))
    if (existing.exists()) return existing.val()
    throw new Error('╪¬╪╣╪░╪▒ ╪¡╪¼╪▓ ╪º┘ä┘ê╪▒╪»┘è╪⌐ ╪¿╪┤┘â┘ä ╪ó┘à┘å. ╪ú╪╣╪» ╪º┘ä┘à╪¡╪º┘ê┘ä╪⌐ ╪¿╪╣╪» ╪º┘ä╪¬╪¡┘é┘é ┘à┘å ╪º┘ä╪¡╪º┘ä╪⌐.')
  }
  await update(ref(db), { [`cashier_shifts/${shiftRef.key}`]: record })
  return record
}

export async function closeAccShift(shiftId, actualCash, denominationCounts = {}) {
  ensureConfigured()
  const user = auth.currentUser
  const shiftSnap = await get(ref(db, `cashier_shifts/${shiftId}`))
  if (!shiftSnap.exists() || shiftSnap.val().status !== 'open') return { already_processed: true }
  const shift = shiftSnap.val()
  if (shift.cashier_uid !== user?.uid) throw new Error('┘ä╪º ┘è┘à┘â┘å┘â ╪Ñ╪║┘ä╪º┘é ┘ê╪▒╪»┘è╪⌐ ┘à╪│╪¬╪«╪»┘à ╪ó╪«╪▒.')
  const movements = values(await get(ref(db, 'cash_movements'))).filter(row => !row.deleted && row.created_by === user.uid && row.created_at >= shift.opened_at)
  const net = movements.reduce((sum, row) => sum + (row.type === 'IN' ? Number(row.amount || 0) : -Number(row.amount || 0)), 0)
  const expected = Number(shift.opening_cash || 0) + net
  const actual = Number(actualCash ?? Object.entries(denominationCounts).reduce((sum, [d, n]) => sum + Number(d) * Number(n || 0), 0))
  const record = { ...shift, expected_cash: expected, actual_cash: actual, difference: actual - expected, denomination_counts: denominationCounts, closed_at: new Date().toISOString(), closed_by: user.uid, status: 'closed' }
  const txn = await runTransaction(ref(db, `cashier_shifts/${shiftId}`), current => current?.status === 'open' ? record : undefined)
  if (txn.committed) await set(ref(db, `cashier_open_shifts/${user.uid}`), null)
  return txn.committed ? record : { already_processed: true }
}

export async function loadAccReports() {
  ensureConfigured()
  const [sales, expenses, movements] = await Promise.all([get(ref(db, 'sales')), get(ref(db, 'expenses')), get(ref(db, 'cash_movements'))])
  return { sales: values(sales).filter(row => row.source_channel === 'POS101'), expenses: values(expenses).filter(row => row.source_channel === 'POS101'), movements: values(movements).filter(row => String(row.source_key || '').startsWith('pos101:')) }
}
