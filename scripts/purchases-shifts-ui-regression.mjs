import assert from 'node:assert/strict'
import fs from 'node:fs'

const dashboard = fs.readFileSync(new URL('../src/components/Dashboard.jsx', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const expenses = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
const reports = fs.readFileSync(new URL('../src/components/Reports.jsx', import.meta.url), 'utf8')
const saleEngine = fs.readFileSync(new URL('../src/services/saleEngine.js', import.meta.url), 'utf8')

assert.doesNotMatch(dashboard, /onNavigate\(['"]purchases['"]\)/)
assert.doesNotMatch(app, /currentView === ['"]purchases['"]/) 
assert.match(expenses, /categories = \['مشتريات'/)
assert.match(expenses, /shiftType:/)
assert.match(app, /shiftType: cashier\.shiftType \|\| cashier\.shiftId/)
assert.match(saleEngine, /shiftType: prepared\.session\.shiftType \|\| prepared\.session\.shiftId/)
assert.match(reports, /data-testid="morning-shift-report-card"/)
assert.match(reports, /data-testid="evening-shift-report-card"/)
assert.match(reports, /data-testid="end-day-report-card"/)
console.log('PURCHASES_SECTION_REMOVED=PASS')
console.log('EXPENSES_DO_NOT_ROUTE_TO_PURCHASES=PASS')
console.log('EXPENSE_PURCHASE_CATEGORY_STAYS_EXPENSE=PASS')
console.log('SALE_STORES_SHIFT_TYPE=PASS')
console.log('EXPENSE_STORES_SHIFT_TYPE=PASS')
