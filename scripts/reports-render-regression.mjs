import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
assert.match(source, /class ReportsErrorBoundary/)
assert.match(source, /Array\.isArray\(salesOverride\)/)
assert.match(source, /Array\.isArray\(expenses\) \? expenses : \[\]/)
assert.match(source, /cashboxTransactions = \[\]/)
assert.match(source, /operationalDay = null/)
assert.match(source, /طباعة تقرير الفترة/)
console.log('REPORTS_RENDER_REGRESSION=PASS')
