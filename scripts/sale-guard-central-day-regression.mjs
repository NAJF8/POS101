import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const engine = fs.readFileSync(new URL('../src/services/saleEngine.js', import.meta.url), 'utf8')

assert.match(engine, /readOperationalDay: readCentralOperationalDay/)
assert.match(engine, /operationalDay\?\.status !== 'open'/)
assert.doesNotMatch(app, /if \(!operationalDayCentralReady \|\| operationalDay\?\.status !== 'open'\)/)
assert.doesNotMatch(app, /localDay\.id !== currentOperationalDay\.id|localDay\.businessDate !== currentOperationalDay\.businessDate/)
assert.match(app, /saleEngine\.sell\(/)

console.log('SALE_GUARD_OPEN_CENTRAL_DAY_IGNORES_STALE_LOCAL_DAY=PASS')
console.log('SALE_GUARD_BLOCKS_CENTRAL_CLOSED_DAY=PASS')
