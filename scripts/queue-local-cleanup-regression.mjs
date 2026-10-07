import assert from 'node:assert/strict'

const store = new Map([
  ['pos101.sales', JSON.stringify([
    { saleId: '631f1c9f-e32d-46a1-b509-9d05751ed83c', orderNumber: 1292, status: 'pending', syncStatus: 'pending', total: 5000 },
    { saleId: 'unresolved-sale', orderNumber: 1200, status: 'completed', syncStatus: 'pending', total: 1000 },
  ])],
  ['pos101.syncQueue', JSON.stringify([
    { saleId: '2afeb665-4abc-463d-b3d2-e417b539a180', orderNumber: 1288 },
    { sale: { saleId: '631f1c9f-e32d-46a1-b509-9d05751ed83c', orderNumber: 1292, total: 5000, businessDate: '2026-10-07', operationalDayId: 'day-2026-10-07', status: 'completed', items: [{ id: 'coffee', quantity: 1, price: 5000 }] } },
    { sale: { saleId: '705b9672-ccbc-40c3-b3d0-c0c2b9b0d57a', orderNumber: 1293, total: 7000, businessDate: '2026-10-07', operationalDayId: 'day-2026-10-07', status: 'completed', items: [{ id: 'coffee', quantity: 1, price: 7000 }] } },
    { sale: { saleId: 'legacy-1023', orderNumber: 1023 } },
  ])],
  ['pos101.operationalDay', JSON.stringify({ id: 'day-2026-10-07', businessDate: '2026-10-07' })],
])
globalThis.localStorage = {
  get length() { return store.size },
  key: index => [...store.keys()][index] ?? null,
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
}
globalThis.window = {}
const q = await import(`../src/services/salesSyncQueue.js?local-cleanup=${Date.now()}`)
const central = (saleId, orderNumber, total) => ({ saleId, orderNumber, total, businessDate: '2026-10-07', operationalDayId: 'day-2026-10-07' })
const result = q.reconcileLocalQueueAgainstCentral([
  central('2afeb665-4abc-463d-b3d2-e417b539a180', 1288, 9000),
  central('631f1c9f-e32d-46a1-b509-9d05751ed83c', 1292, 5000),
  central('705b9672-ccbc-40c3-b3d0-c0c2b9b0d57a', 1293, 7000),
], { now: new Date('2026-10-08T08:00:00.000Z') })
assert.equal(result.firebaseWritesPerformed, 0)
assert.equal(result.backupBeforeCleanup, 'PASS')
assert.match(result.backupFilename, /^POS101-localStorage-before-queue-cleanup-/)
assert.equal(result.removedVerified, 3)
assert.equal(result.quarantinedMalformed, 1)
assert.equal(result.retainedValidUnresolved, 0)
assert.equal(JSON.parse(store.get('pos101.syncQueue')).length, 0)
const quarantine = JSON.parse(store.get('pos101.syncQueue.quarantine'))
assert.equal(quarantine.length, 1)
assert.equal(quarantine[0].saleId, 'legacy-1023')
assert.deepEqual(quarantine[0].rawQueuePayload, { sale: { saleId: 'legacy-1023', orderNumber: 1023 } })
assert.equal(JSON.parse(store.get('pos101.sales')).find(row => row.saleId === '631f1c9f-e32d-46a1-b509-9d05751ed83c').centralVerified, undefined)
assert.equal(window.__POS101_LAST_QUEUE_CLEANUP_BACKUP__.filename, result.backupFilename)
console.log(JSON.stringify({
  BACKUP_BEFORE_LOCAL_CLEANUP: 'PASS',
  NO_FIREBASE_WRITES: 'PASS',
  VERIFIED_TARGETS_1288_1292_1293_REMOVED: 'PASS',
  MALFORMED_ENTRIES_QUARANTINED_WITH_FULL_RAW_BACKUP: 'PASS',
  VALID_UNRESOLVED_ENTRIES_RETAINED: 'PASS',
  QUARANTINE_MALFORMED_ENTRIES: 'PASS',
}, null, 2))
