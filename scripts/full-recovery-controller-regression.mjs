import assert from 'node:assert/strict'

const store = new Map([
  ['pos101.sales', JSON.stringify([{ saleId: 'sale-1' }])],
  ['pos101.expenses', JSON.stringify([{ id: 'expense-1', amount: 100 }])],
  ['pos101.operationalDay', JSON.stringify({ id: 'day-1', status: 'open', businessDate: '2026-10-03' })],
  ['pos101.session', JSON.stringify({ name: 'اختبار' })],
  ['pos101.deviceId', 'device-1'],
])
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) }

const { createFullRecoveryClickHandler } = await import('../src/services/fullRecoveryController.js')
let starts = 0
let runs = 0
let successes = 0
const handler = createFullRecoveryClickHandler({
  getCurrentUser: () => ({ uid: 'test-admin', authorization: { role: 'admin', active: true, authorized: true } }),
  runRecovery: async () => { runs += 1; await new Promise(resolve => setTimeout(resolve, 20)); return { ok: true } },
  onStart: () => { starts += 1 },
  onSuccess: () => { successes += 1 },
})

const first = handler()
const second = handler()
assert.deepEqual(await second, { skipped: true })
assert.equal((await first).ok, true)
assert.equal(starts, 1)
assert.equal(runs, 1)
assert.equal(successes, 1)
const backups = [...store.keys()].filter(key => key.startsWith('pos101.fullRecoveryBackup.'))
assert.equal(backups.length, 1)
const backup = JSON.parse(store.get(backups[0]))
assert.equal(backup.sales.length, 1)
assert.equal(backup.expenses.length, 1)
assert.equal(backup.operationalDay.status, 'open')
console.log('FULL_RECOVERY_CONTROLLER_REGRESSION=PASS')
