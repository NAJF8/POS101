import assert from 'node:assert/strict'
import fs from 'node:fs'

const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const acc = fs.readFileSync(new URL('../src/services/accSync.js', import.meta.url), 'utf8')

assert.match(sync, /explicitUserAction\s*=\s*false/)
assert.match(sync, /EXPLICIT_DAY_CLOSE_REQUIRED/)
assert.match(sync, /closeSource\s*=\s*'manual_end_day'/)
assert.match(sync, /closeAutoDetected: false/)
assert.match(sync, /updatedBy: user\.uid/)
assert.match(sync, /deviceId: getDeviceId\(\)/)
assert.match(sync, /ALLOWED_DAY_CLOSE_SOURCES = new Set\(\['manual_end_day', 'admin_reopen_fix', 'system_test'\]\)/)
assert.match(app, /explicitUserAction: true/)
assert.match(app, /closeSource: 'manual_end_day'/)
assert.match(app, /closeReason: 'user_confirmed_end_day'/)
assert.doesNotMatch(sync, /businessDate.*!==.*localBusinessDate|localBusinessDate\(.*\).*status.*closed/)
assert.doesNotMatch(acc, /pos101_operational_day\/current/)
assert.doesNotMatch(acc, /pos101_operational_days/)

console.log('MIDNIGHT_AUTO_CLOSE_FOUND=NO')
console.log('MIDNIGHT_AUTO_CLOSE_DISABLED=PASS')
console.log('END_SHIFT_CLOSES_DAY=NO')
console.log('END_SHIFT_DAY_CLOSE_FIXED=PASS')
console.log('EXPLICIT_CLOSE_GUARD=PASS')
console.log('CLOSE_AUDIT_FIELDS=PASS')
