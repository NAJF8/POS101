import assert from 'node:assert/strict'
import { beginPreCloseCheck, completePreCloseCheck, failPreCloseCheck, isCurrentPreCloseRequest, PRE_CLOSE_STATE } from '../src/services/preCloseGuard.js'

const initial = { loading: false, state: PRE_CLOSE_STATE.UNKNOWN, allowed: true, message: '' }
const checking = beginPreCloseCheck(initial)
assert.deepEqual(checking, { ...initial, loading: true, state: PRE_CLOSE_STATE.CHECKING, allowed: false, message: '', error: null })

const allowed = completePreCloseCheck({ allowed: true, salesReconciliation: { allowed: true }, financialReconciliation: { allowed: true } })
assert.equal(allowed.loading, false)
assert.equal(allowed.state, PRE_CLOSE_STATE.ALLOWED)
assert.equal(allowed.allowed, true)

const blocked = completePreCloseCheck({ allowed: false, message: 'mismatch' })
assert.equal(blocked.state, PRE_CLOSE_STATE.BLOCKED)
assert.equal(blocked.allowed, false)
assert.equal(blocked.message, 'mismatch')

const error = failPreCloseCheck(Object.assign(new Error('read failed'), { code: 'READ_FAILED' }))
assert.equal(error.state, PRE_CLOSE_STATE.ERROR)
assert.equal(error.allowed, false)
assert.equal(error.error.code, 'READ_FAILED')

assert.equal(isCurrentPreCloseRequest(12, 12), true)
assert.equal(isCurrentPreCloseRequest(11, 12), false)

let applied = null
const apply = (requestId, currentRequestId, result) => {
  if (!isCurrentPreCloseRequest(requestId, currentRequestId)) return false
  applied = completePreCloseCheck(result)
  return true
}
assert.equal(apply(11, 12, { allowed: false }), false)
assert.equal(apply(12, 12, { allowed: true }), true)
assert.equal(applied.allowed, true)

console.log('PRE_CLOSE_GUARD_STATES=PASS')
console.log('PRE_CLOSE_STALE_RESULT_IGNORED=PASS')
console.log('PRE_CLOSE_ERROR_STATE=PASS')
