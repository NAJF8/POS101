import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
assert.match(source, /class ReportsErrorBoundary/)
assert.match(source, /Array\.isArray\(salesOverride\)/)
assert.match(source, /Array\.isArray\(expenses\) \? expenses : \[\]/)
assert.match(source, /cashboxTransactions = \[\]/)
assert.match(source, /operationalDay = null/)
assert.match(source, /طباعة تقرير الفترة/)
assert.match(source, /centralSalesReadError/)
assert.match(source, /data-testid=\"central-sales-read-error\"/)
assert.match(source, /لم يتم اعتبار الصفر نتيجة مالية/)
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
assert.match(appSource, /setCentralSalesReadError/)
const syncSource = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
assert.match(syncSource, /subscribeCentralSales = \(callback, authenticatedUser = auth\?\.currentUser, onError = null\)/)
console.log('REPORTS_RENDER_REGRESSION=PASS')
