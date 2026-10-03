import assert from 'node:assert/strict'

const store = new Map([
  ['pos101.sales', JSON.stringify([{ saleId: 'sale-1' }])],
  ['pos101.expenses', JSON.stringify([{ id: 'expense-1', amount: 100 }])],
  ['pos101.operationalDay', JSON.stringify({ id: 'day-1', status: 'open', businessDate: '2026-10-03' })],
])
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) }

const { getCentralPermissions, getCentralRole, isAuthorizedPosSyncUser } = await import('../src/services/posCentralSync.js')
const { createCentralSyncClickHandler } = await import('../src/services/centralSyncController.js')
const { createFullRecoveryClickHandler } = await import('../src/services/fullRecoveryController.js')

const user = (uid, role) => ({ uid, email: `${role}@example.test`, authorization: { role, active: true, authorized: true } })
const cashier = user('authorized-cashier', 'cashier')
const admin = user('authorized-admin', 'admin')
const manager = user('authorized-manager', 'manager')
const unknown = { uid: 'unknown-user', email: 'unknown@example.test' }

for (const account of [cashier, admin, manager]) assert.equal(await isAuthorizedPosSyncUser(account), true)
assert.equal(await isAuthorizedPosSyncUser(unknown), false)
for (const account of [cashier, admin, manager]) {
  assert.equal(getCentralPermissions(account).centralWrite, true)
  assert.equal(getCentralPermissions(account).uploadLocalSales, true)
}

let salesRuns = 0
let expenseRuns = 0
const syncClick = createCentralSyncClickHandler({
  getCurrentUser: () => manager,
  runCashierSync: async () => { salesRuns += 1; expenseRuns += 1; return { uploaded: 1, expenseUploaded: 1 } },
  onError: error => { throw error },
})
await syncClick()
assert.equal(salesRuns, 1)
assert.equal(expenseRuns, 1)

let recoveryRuns = 0
const recoveryClick = createFullRecoveryClickHandler({
  getCurrentUser: () => admin,
  runRecovery: async () => { recoveryRuns += 1; return { operationalDay: { status: 'open' } } },
})
const recovery = await recoveryClick()
assert.equal(recoveryRuns, 1)
assert.equal(recovery.operationalDay.status, 'open')

const beforeKeys = [...store.keys()]
const denied = await createFullRecoveryClickHandler({ getCurrentUser: () => unknown, runRecovery: async () => { throw new Error('must not run') } })()
assert.equal(denied.error.code, 'CENTRAL_ROLE_BLOCKED')
assert.deepEqual([...store.keys()], beforeKeys)

console.log(JSON.stringify({
  'authorized-sync-cashier': 'PASS',
  'authorized-sync-admin': 'PASS',
  'authorized-sync-manager': 'PASS',
  'unauthorized-sync-denied': 'PASS',
  'full-recovery-authorized-user': 'PASS',
  'expense-sync-authorized-user': 'PASS',
  'sales-sync-authorized-user': 'PASS',
}, null, 2))
