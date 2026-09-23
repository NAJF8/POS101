import { initializeApp, getApps } from 'firebase/app'
import {
  getAuth,
  connectAuthEmulator,
  onAuthStateChanged,
  signInWithEmailAndPassword,
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
if (configured) {
  app = getApps().find(item => item.name === 'pos101-acc') || initializeApp(firebaseConfig, 'pos101-acc')
  auth = getAuth(app)
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
const todayBaghdad = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date())
const monthOf = date => String(date || todayBaghdad()).slice(0, 7)
const normalize = value => String(value || '').trim().toLowerCase().replace(/[┘ï┘î┘ì┘Ä┘Å┘É┘æ┘Æ┘Ç]/g, '').replace(/[╪Ñ╪ú╪ó]/g, '╪º').replace(/┘ë/g, '┘è').replace(/\s+/g, ' ')
const values = snapshot => snapshot.exists() ? Object.entries(snapshot.val()).map(([id, value]) => ({ id, ...value })) : []
const saleFingerprint = sale => JSON.stringify({
  items: (sale.items || []).map(item => ({ product_id: item.accProductId || item.product_id || item.id, quantity: Number(item.quantity || 0), unit_price: Number(item.price || 0) })),
  subtotal: Number(sale.subtotal || 0), discount: Number(sale.discount || 0), total: Number(sale.total || 0), payment_method: sale.paymentMethod || ''
})

export const isAccConfigured = () => configured
export const isAccEmulator = () => useEmulator
export const accAuth = () => auth
export const subscribeAuth = callback => {
  if (!configured) return () => {}
  return onAuthStateChanged(auth, callback)
}

export async function loginToAcc(email, password) {
  ensureConfigured()
  const credential = await signInWithEmailAndPassword(auth, String(email).trim(), password)
  const profileSnap = await get(ref(db, `users/${credential.user.uid}`))
  const profile = profileSnap.exists() ? profileSnap.val() : null
  if (!profile || profile.active === false) {
    await signOut(auth)
    throw new Error('╪¡╪│╪º╪¿ ╪º┘ä┘â╪º╪┤┘è╪▒ ╪║┘è╪▒ ┘à┘ü╪╣┘æ┘ä ┘ü┘è ACC-101.')
  }
  return { ...profile, id: credential.user.uid, email: credential.user.email }
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

export async function saveAccSale(sale, profile) {
  ensureConfigured()
  const user = auth.currentUser
  if (!user || !profile?.id) throw new Error('╪º┘å╪¬┘ç╪¬ ╪¼┘ä╪│╪⌐ ╪º┘ä┘â╪º╪┤┘è╪▒. ╪│╪¼┘æ┘ä ╪º┘ä╪»╪«┘ê┘ä ┘à╪¼╪»╪»╪º┘ï.')
  const date = todayBaghdad()
  const operationKey = cleanKey(`pos101:${sale.saleId || sale.id}`)
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

export async function saveAccExpense(expense, profile) {
  ensureConfigured()
  const user = auth.currentUser
  if (!user || !profile?.id) throw new Error('╪º┘å╪¬┘ç╪¬ ╪¼┘ä╪│╪⌐ ╪º┘ä┘â╪º╪┤┘è╪▒. ╪│╪¼┘æ┘ä ╪º┘ä╪»╪«┘ê┘ä ┘à╪¼╪»╪»╪º┘ï.')
  const id = cleanKey(`pos101:${expense.id}`)
  const record = { id, source_channel: 'POS101', date: todayBaghdad(), month: monthOf(), amount: Number(expense.amount), category: expense.category || '╪ú╪«╪▒┘ë', description: expense.notes || '', payment_method: 'cash', paid_amount: Number(expense.amount), payment_status: 'paid', shift_id: expense.shiftId || '', created_at: new Date().toISOString(), created_by: user.uid, created_by_name: profile.name || '' }
  const existing = await get(ref(db, `expenses/${id}`))
  if (existing.exists()) return { ...existing.val(), already_processed: true }
  const cashId = cleanKey(`pos101:expense:${id}`)
  await update(ref(db), {
    [`expenses/${id}`]: record,
    [`cash_movements/${cashId}`]: { id: cashId, type: 'OUT', amount: record.amount, date: record.date, month: record.month, payment_method: 'cash', source_type: 'expense', source_id: id, source_key: `expense:${id}`, created_at: record.created_at, created_by: user.uid, auto: true },
  })
  return { ...record, already_processed: false }
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
