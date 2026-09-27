import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
const queue = await import('../src/services/salesSyncQueue.js');
const sale = { saleId: 'old-local-sale', operationKey: 'pos101:old-local-sale', items: [{ id: 'ready-test', quantity: 1, price: 1000 }] };
queue.enqueueSale(sale);
queue.enqueueSale(sale);
const restored = JSON.parse(localStorage.getItem('pos101.sales'));
assert.deepEqual(restored, [sale]);
assert.equal(queue.readSaleQueue().length, 0);
assert.equal(queue.readPendingSaleCount(), 1);
const backup = queue.buildSalesBackup('2026-09-27T12:00:00.000Z');
assert.equal(backup.createdAt, '2026-09-27T12:00:00.000Z');
assert.equal(backup.salesCount, 1);
assert.equal(backup['pos101.sales'].length, 1);
assert.equal(Object.hasOwn(backup, 'pos101.syncQueue'), false);
console.log(JSON.stringify({ local_only: true, production_target_used: 'NO', results: { duplicate_prevented: true, local_ledger_unchanged: true, backup_complete: true, sync_queue_unused: true } }, null, 2));
