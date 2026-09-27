import assert from 'node:assert/strict'
import { buildSalesMaintenancePlan, runSalesMaintenance } from '../src/services/salesMaintenance.js'

const makeSale = orderNumber => ({ saleId: `sale-${orderNumber}`, id: `sale-${orderNumber}`, orderNumber, createdAt: orderNumber })
const seed = Array.from({ length: 33 }, (_, index) => makeSale(1023 + index))
const plan = buildSalesMaintenancePlan(seed)
assert.equal(plan.currentCount, 33)
assert.deepEqual(plan.deleteOrderNumbers, Array.from({ length: 28 }, (_, index) => 1023 + index))
assert.deepEqual(plan.newRows.map(row => row.orderNumber), [1053, 1054, 1055])
assert.equal(plan.required[0].count, 1)
assert.equal(plan.required[1].count, 1)

const values = new Map([['pos101.sales', JSON.stringify(seed)]])
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }
const result = runSalesMaintenance({ storage, download: false })
const after = JSON.parse(values.get('pos101.sales'))
assert.deepEqual(after.map(row => row.orderNumber), [1051, 1052, 1053, 1054, 1055])
assert.equal(result.backup.salesCount, 33)
assert.equal(result.backup['pos101.sales'].length, 33)
assert.equal(result.duplicateSaleIds.length, 0)
console.log(JSON.stringify({ fixture: '1023..1055', deleted: result.deletedCount, remaining: after.map(row => row.orderNumber), backupValid: true }, null, 2))
