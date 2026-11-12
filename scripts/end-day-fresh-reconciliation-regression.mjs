import assert from 'node:assert/strict'
import fs from 'node:fs'
import { reconcileCanonicalSales } from '../src/services/canonicalSales.js'

const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const prepareBlock = appSource.slice(appSource.indexOf('const prepareEndOperationalDay'), appSource.indexOf('const handleEndOperationalDay'))

const day = { id: 'day-2026-11-11', businessDate: '2026-11-11', status: 'open' }
const sale = (id, total) => ({
  saleId: id,
  id,
  operationKey: `pos101:${id}`,
  operationalDayId: day.id,
  businessDate: day.businessDate,
  subtotal: total,
  discount: 0,
  total,
  paymentMethod: 'cash',
  status: 'completed',
})

const local = [sale('sale-1', 10000), sale('sale-2', 5000)]
const freshCentral = local.map(row => ({ ...row }))
const staleCentral = [sale('sale-old', 15000)]

// A stale React snapshot fails, while the fresh central read passes.
assert.equal(reconcileCanonicalSales({ localSales: local, centralSales: staleCentral, operationalDay: day }).allowed, false)
assert.equal(reconcileCanonicalSales({ localSales: local, centralSales: freshCentral, operationalDay: day }).allowed, true)

// The end-day callback must bind reconciliation and settlement to the
// snapshot returned by readPreCloseReconciliation, never the React state.
assert.match(prepareBlock, /const freshCentralSales = Array\.isArray\(guard\?\.freshCentralSales\) \? guard\.freshCentralSales : \[\]/)
assert.match(prepareBlock, /const localSales = readLocalSales\(\)[\s\S]*reconcileCanonicalSales\(\{ localSales, centralSales: freshCentralSales, operationalDay \}\)/)
assert.match(prepareBlock, /readFreshSettlementPreview\(operationalDay, \{ centralSales: freshCentralSales \}\)/)
assert.doesNotMatch(prepareBlock, /reconcileCanonicalSales\(\{ localSales: readLocalSales\(\), centralSales, operationalDay \}\)/)

console.log('TEST_1_STALE_REACT_SNAPSHOT_IGNORED=PASS')
console.log('TEST_2_FRESH_CENTRAL_MISMATCH_STILL_BLOCKS=PASS')
console.log('TEST_3_END_DAY_USES_SINGLE_FRESH_SNAPSHOT=PASS')
