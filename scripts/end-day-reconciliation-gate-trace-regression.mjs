import assert from 'node:assert/strict'
import fs from 'node:fs'
import { reconcileCanonicalSales } from '../src/services/canonicalSales.js'
import { recordEndDayReconciliationTrace } from '../src/services/endDayReconciliationTrace.js'

globalThis.window = {}
const day = { id: 'day-2026-11-11', businessDate: '2026-11-11' }
const sale = (id, total) => ({ saleId: id, id, operationKey: `pos101:${id}`, operationalDayId: day.id, businessDate: day.businessDate, subtotal: total, discount: 0, total, paymentMethod: 'cash', status: 'completed' })
const local = [sale('sale-1', 10000), sale('sale-2', 5000)]
const fresh = local.map(row => ({ ...row }))
const mismatched = [sale('sale-1', 9000), sale('sale-2', 5000)]

const first = reconcileCanonicalSales({ localSales: local, centralSales: fresh, operationalDay: day })
recordEndDayReconciliationTrace({ caller: 'App.prepareEndOperationalDay', localSales: local, centralSales: fresh, reconciliation: first, freshCentralSales: fresh, localSource: 'readLocalSales()', centralSource: 'readPreCloseReconciliation().freshCentralSales' })
assert.equal(first.allowed, true)
assert.equal(window.__POS101_END_DAY_RECONCILIATION_TRACE__.at(-1).sameFreshCentralSnapshot, true)

const second = reconcileCanonicalSales({ localSales: local, centralSales: mismatched, operationalDay: day })
recordEndDayReconciliationTrace({ caller: 'settleAndEndOperationalDay.financialReconciliation', localSales: local, centralSales: mismatched, reconciliation: second, freshCentralSales: fresh, localSource: 'readLocalSales()', centralSource: 'get(salesRef()) -> centralBeforeWrite' })
assert.equal(second.allowed, false)
assert.deepEqual(window.__POS101_END_DAY_RECONCILIATION_TRACE__.at(-1).mismatchDetails, [{ field: 'gross', local: 15000, central: 14000 }, { field: 'net', local: 15000, central: 14000 }, { field: 'cash', local: 15000, central: 14000 }])
assert.equal(window.__POS101_END_DAY_RECONCILIATION_TRACE__.at(-1).sameFreshCentralSnapshot, false)
assert.equal(window.__POS101_END_DAY_RECONCILIATION_TRACE__.length, 2)

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const ui = fs.readFileSync(new URL('../src/components/OperationalDay.jsx', import.meta.url), 'utf8')
const trace = fs.readFileSync(new URL('../src/services/endDayReconciliationTrace.js', import.meta.url), 'utf8')
assert.match(trace, /END_DAY_RECONCILIATION_GATE/)
assert.match(sync, /settleAndEndOperationalDay\.financialReconciliation/)
assert.match(ui, /OperationalDay\.openEnd\.exception/)

console.log('END_DAY_RECONCILIATION_GATE_TRACE=PASS')
console.log('TRACE_INVOCATION_COUNT=2')
console.log('TRACE_REAL_MISMATCH_DETAILS=PASS')
console.log('TRACE_EXCEPTION_PATH=PASS')
