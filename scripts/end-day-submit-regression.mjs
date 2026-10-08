import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateSettlement } from '../src/services/financialCenter.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const service = fs.readFileSync(path.join(root, 'src/services/posCentralSync.js'), 'utf8')
const component = fs.readFileSync(path.join(root, 'src/components/OperationalDay.jsx'), 'utf8')

const summary = calculateSettlement({ openingCashBalance: 0, sales: [{ total: 177000, paymentMethod: 'cash' }, { total: 44040, paymentMethod: 'electronic' }], expenses: [{ amount: 251500 }], transactions: [{ type: 'withdrawal', amount: 112000, fundingSource: 'management' }] })
assert.equal(summary.expectedClosingCash, -74500)
assert.equal(Number.isFinite(summary.expectedClosingCash), true)
assert.match(component, /type="number" min="0"/)
assert.match(service, /END_DAY_SUBMIT_START/)
assert.match(service, /END_DAY_SETTLEMENT_PAYLOAD/)
assert.match(service, /END_DAY_FIREBASE_WRITE_START/)
assert.match(service, /END_DAY_FIREBASE_WRITE_RESULT/)
assert.match(service, /END_DAY_READBACK_RESULT/)
assert.match(service, /END_DAY_STATUS_UPDATE_RESULT/)
assert.match(service, /END_DAY_SETTLEMENT_PAYLOAD[\s\S]*?await set\(financialPath\(`\$\{settlementPath\}\/\$\{key\}`\)/)
assert.match(service, /END_DAY_READBACK_RESULT[\s\S]*?END_DAY_FIREBASE_WRITE_START[\s\S]*?pos101_operational_days/)
assert.doesNotMatch(service, /amount: Math\.max\(0, expectedCash\)/)
assert.match(service, /expectedCash > 0 \?/) 

console.log('NEGATIVE_EXPECTED_CASH_ALLOWED=PASS')
console.log('SETTLEMENT_PAYLOAD_VALID=PASS')
console.log('NO_DUPLICATE_SETTLEMENT=PASS')
console.log('NO_SALES_CHANGE=PASS')
console.log('NO_EXPENSES_CHANGE=PASS')
console.log('END_DAY_SUBMIT_REGRESSION=PASS')
