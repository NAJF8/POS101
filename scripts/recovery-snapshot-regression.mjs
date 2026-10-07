import assert from 'node:assert/strict'

const targets = ['b7cadbed-f6aa-4817-9ded-73fe3b011092', '544092ff-551f-4471-b36b-86f9a4bb9668', '6c1c7255-4303-4645-85f3-dc375dff2e2a', '6832c823-a0ff-463d-b6f7-208cf3c712cd', '68c828ae-1f09-4980-9087-f9410f334cbc', '3cd2d052-a53e-4c5b-802e-8897537ff8da', 'f49b7f05-4b9f-4549-a63d-d0e7a5bc2bcb', '2afeb665-4abc-463d-b3d2-e417b539a180']
const sales = targets.map((saleId, index) => ({ saleId, orderNumber: 1273 + index, total: 1000 + index, items: [{ id: `item-${index}`, quantity: 1, price: 1000 + index }] }))
const queue = targets.map((saleId, index) => ({ kind: 'sale', saleId, sale: { ...sales[index], operationKey: `pos101:${saleId}` }, untouched: `raw-${index}` }))
const rawSales = JSON.stringify(sales)
const rawQueue = JSON.stringify(queue)
const values = new Map([['pos101.sales', rawSales], ['pos101.syncQueue', rawQueue], ['pos101.salesQuarantine', '[]'], ['pos101.operationalDay', JSON.stringify({ businessDate: '2026-10-07', operationalDayId: 'day-1' })], ['pos101.deviceId', 'kiosk-test']])
let writes = 0
const storage = { getItem: key => values.get(key) ?? null, setItem: () => { writes += 1 }, removeItem: () => { writes += 1 } }
const { createRecoverySnapshot } = await import('../src/services/recoverySnapshot.js')
const snapshot = await createRecoverySnapshot({ storage, buildSha: 'abc1234', now: () => new Date('2026-10-07T19:00:00.000Z'), documentImpl: null, indexedDbImpl: null })
assert.equal(snapshot.integrity.recordCount, 8)
assert.equal(snapshot.integrity.queueCount, 8)
assert.equal(snapshot.integrity.targetRecordsFound, 8)
assert.equal(snapshot.integrity.targetQueueRecordsFound, 8)
assert.equal(snapshot.localStorage['pos101.sales'], rawSales)
assert.equal(snapshot.localStorage['pos101.syncQueue'], rawQueue)
assert.deepEqual(snapshot.targets[3].saleRecords[0], sales[3])
assert.deepEqual(snapshot.targets[3].queueRecords[0], queue[3])
assert.equal(writes, 0)
console.log(JSON.stringify({ EXPORT_TARGETS_PRESENT: 'PASS', EXPORT_PAYLOAD_EXACT: 'PASS', EXPORT_NO_WRITES: 'PASS' }, null, 2))
