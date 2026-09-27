import assert from 'node:assert/strict'
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth'
import { connectDatabaseEmulator, get, getDatabase, onValue, ref, set } from 'firebase/database'

const config = { apiKey: 'pos101-emulator-api-key', authDomain: 'cmms-37512.firebaseapp.com', databaseURL: 'http://127.0.0.1:9000?ns=cmms-37512-default-rtdb', projectId: 'cmms-37512', appId: 'pos101-emulator-app' }
const makeClient = name => {
  const app = initializeApp(config, name)
  const auth = getAuth(app)
  const db = getDatabase(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectDatabaseEmulator(db, '127.0.0.1', 9000)
  return { auth, db }
}
const seedAuthorizedUid = async uid => {
  const response = await fetch(`http://127.0.0.1:9000/pos101_authorized_uids/${uid}.json?ns=cmms-37512-default-rtdb&access_token=owner`, { method: 'PUT', body: 'true' })
  if (!response.ok) throw new Error(`Emulator seed failed: ${response.status}`)
}
const uniqueSales = value => Object.values(value || {}).filter(sale => sale?.saleId).length

const a = makeClient('emulator-a')
const b = makeClient('emulator-b')
const c = makeClient('emulator-c')
const userA = (await createUserWithEmailAndPassword(a.auth, `pos101-a-${Date.now()}@example.test`, 'TestPass123!')).user
const userB = (await createUserWithEmailAndPassword(b.auth, `pos101-b-${Date.now()}@example.test`, 'TestPass123!')).user
const userC = (await createUserWithEmailAndPassword(c.auth, `pos101-c-${Date.now()}@example.test`, 'TestPass123!')).user
await seedAuthorizedUid(userA.uid)
await seedAuthorizedUid(userB.uid)

const sales = Array.from({ length: 70 }, (_, index) => ({
  saleId: `historical-sale-${index + 1}`,
  createdAt: 1700000000000 + index,
  orderNumber: 1000 + index,
  total: 5000,
  items: [],
}))
let realtime = null
const stop = onValue(ref(b.db, 'pos101_sales'), snapshot => { realtime = snapshot.val() })

for (const sale of sales) await set(ref(a.db, `pos101_sales/${sale.saleId}`), sale)
assert.equal(uniqueSales((await get(ref(a.db, 'pos101_sales'))).val()), 70)

// Repeating the exact initial sync is idempotent: same keys, still 70 records.
for (const sale of sales) await set(ref(a.db, `pos101_sales/${sale.saleId}`), sale)
assert.equal(uniqueSales((await get(ref(a.db, 'pos101_sales'))).val()), 70)
await new Promise(resolve => setTimeout(resolve, 150))
assert.equal(uniqueSales(realtime), 70)
assert.equal(uniqueSales((await get(ref(b.db, 'pos101_sales'))).val()), 70)

const newSale = { saleId: 'post-initial-sale-71', createdAt: Date.now(), orderNumber: 1071, total: 3500, items: [] }
await set(ref(a.db, `pos101_sales/${newSale.saleId}`), newSale)
await new Promise(resolve => setTimeout(resolve, 150))
assert.equal(uniqueSales((await get(ref(b.db, 'pos101_sales'))).val()), 71)
assert.equal(uniqueSales((await get(ref(a.db, 'pos101_sales'))).val()), 71)

await assert.rejects(() => get(ref(c.db, 'pos101_sales')))
await assert.rejects(() => set(ref(c.db, 'pos101_sales/unauthorized'), newSale))
await assert.rejects(() => set(ref(a.db, 'other_cmms_path/test'), { mustNotWrite: true }))

stop()
console.log(JSON.stringify({
  initial_upload_70: 'PASS',
  second_sync_uploaded_new: 0,
  central_unique_after_initial: 70,
  duplicate_prevention: 'PASS',
  second_device_merge: 'PASS',
  realtime_listener: 'PASS',
  new_sale_71: 'PASS',
  unauthorized_read_write: 'PASS',
  other_paths_unchanged: 'PASS',
}, null, 2))
