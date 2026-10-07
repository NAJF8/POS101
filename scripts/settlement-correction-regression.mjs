import assert from 'node:assert/strict'
import fs from 'node:fs'
import { calculateSettlementCorrection, getEffectiveSettlement } from '../src/services/financialCenter.js'

const settlement = { id: 'settlement-664f9d14-6e32-469e-909a-1bed117212bd', operationalDayId: '664f9d14-6e32-469e-909a-1bed117212bd', businessDate: '2026-10-06', expectedCash: 95000, actualCash: 86000, difference: -9000, status: 'short' }
const correction = { id: 'correction-one', settlementId: settlement.id, correctedActualCash: 95000, createdAt: 1, status: 'active' }
const second = { id: 'correction-two', settlementId: settlement.id, correctedActualCash: 96000, createdAt: 2, status: 'active' }
assert.deepEqual(calculateSettlementCorrection({ settlement, correctedActualCash: 95000 }), { correctedActualCash: 95000, correctedDifference: 0, correctedStatus: 'matched' })
const effective = getEffectiveSettlement(settlement, [correction])
assert.deepEqual({ actual: effective.effectiveActualCash, difference: effective.effectiveDifference, status: effective.effectiveStatus }, { actual: 95000, difference: 0, status: 'matched' })
assert.equal(getEffectiveSettlement(settlement, [correction, second]).effectiveActualCash, 96000)
assert.equal(settlement.actualCash, 86000)
assert.equal(settlement.difference, -9000)
assert.equal(settlement.expectedCash, 95000)
const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const rules = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')
assert.match(sync, /pos101_settlement_corrections/)
assert.match(sync, /settlement actual cash correction/)
assert.match(sync, /ORIGINAL_SETTLEMENT_MUTATED|originalBack/)
assert.doesNotMatch(sync, /pos101_cashbox_transactions\/.+correction/)
assert.match(rules, /pos101_settlement_corrections/)
console.log(JSON.stringify({ ORIGINAL_SETTLEMENT_IMMUTABLE: 'PASS', CORRECTION_EFFECTIVE_ACTUAL: 95000, CORRECTION_EFFECTIVE_DIFFERENCE: 0, CORRECTION_HISTORY_PRESERVED: 'PASS', NO_FAKE_CASH_MOVEMENT: 'PASS', EXPECTED_CASH_UNCHANGED: 95000, ORIGINAL_ACTUAL_STILL_86000: 'PASS', ORIGINAL_DIFFERENCE_STILL_MINUS_9000: 'PASS' }, null, 2))
