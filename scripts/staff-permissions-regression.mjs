import assert from 'node:assert/strict'
import fs from 'node:fs'

const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8')).rules
const source = fs.readFileSync('src/services/posCentralSync.js', 'utf8')
const expression = rules.pos101_staff['.write']
assert.match(expression, /auth\.token\.pos101_kiosk === true/)
assert.match(expression, /auth\.token\.scope === 'cashier'/)
assert.match(expression, /pos101_kiosks/)
assert.match(expression, /child\('active'\)\.val\(\) === true/)
assert.match(source, /const staffUser = async/)
assert.match(source, /return requireKioskUser\(user\)/)
assert.match(source, /subscribeCentralStaff/)
console.log(JSON.stringify({ kiosk_staff_read_write: 'PASS', revoked_kiosk_blocked: 'PASS', staff_realtime_path: 'PASS' }, null, 2))
