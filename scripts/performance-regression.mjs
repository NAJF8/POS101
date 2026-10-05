import assert from 'node:assert/strict'
import fs from 'node:fs'

const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const reports = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
assert.match(sync, /persistCache = true, dispatchUpdate = true/)
assert.match(reports, /persistCache: false, dispatchUpdate: false/)
assert.match(sync, /if \(cacheChanged && dispatchUpdate\) dispatchExpensesUpdated\(\)/)
assert.match(sync, /if \(localStorage\.getItem\(EXPENSES_KEY\) === next\) return false/)
assert.match(reports, /expenseReadInFlight = useRef\(false\)/)
assert.match(reports, /setTimeout\(\(\) => \{ refreshTimer = null; void refreshCentral\(\) \}, 200\)/)
assert.match(reports, /if \(reportType !== 'period'\) return EMPTY_PERIOD_DATASET/)
console.log('PERFORMANCE_REGRESSION=PASS')
