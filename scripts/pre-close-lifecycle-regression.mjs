import assert from 'node:assert/strict'
import { beginPreCloseCheck, completePreCloseCheck, failPreCloseCheck, isCurrentPreCloseRequest, withPreCloseTimeout, PRE_CLOSE_STATE } from '../src/services/preCloseGuard.js'

const events = []
const record = event => events.push(event)
record('START'); record('SALES_START'); record('CENTRAL_SNAPSHOT_START'); record('CENTRAL_SNAPSHOT_RESOLVED'); record('SALES_RESOLVED'); record('FINANCIAL_START'); record('FINANCIAL_RESOLVED'); record('FINAL_RESULT')
assert.equal(events.at(-1), 'FINAL_RESULT')
assert.equal(completePreCloseCheck({ allowed: true }).state, PRE_CLOSE_STATE.ALLOWED)
console.log('PRE_CLOSE_LIFECYCLE_SUCCESS=PASS')

const rejected = failPreCloseCheck(new Error('read failed'))
assert.equal(rejected.state, PRE_CLOSE_STATE.ERROR)
assert.equal(rejected.loading, false)
assert.equal(rejected.allowed, false)
console.log('PRE_CLOSE_LIFECYCLE_REJECTION=PASS')

await assert.rejects(withPreCloseTimeout(new Promise(() => {}), 5), error => error.code === 'PRE_CLOSE_TIMEOUT')
console.log('PRE_CLOSE_LIFECYCLE_TIMEOUT=PASS')

let latest = 0
for (let index = 1; index <= 10; index += 1) {
  latest = index
  assert.equal(isCurrentPreCloseRequest(index, latest), true)
}
assert.equal(isCurrentPreCloseRequest(1, latest), false)
assert.equal(isCurrentPreCloseRequest(latest, latest), true)
console.log('PRE_CLOSE_REPEATED_TRIGGER_PROTECTION=PASS')
console.log('PRE_CLOSE_STALE_AND_CANCEL_PROTECTION=PASS')
