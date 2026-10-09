import assert from 'node:assert/strict'
import fs from 'node:fs'

const component = fs.readFileSync(new URL('../src/components/Expenses.jsx', import.meta.url), 'utf8')
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
for (const text of ['مصروف اليوم الحالي', 'مصروف سابق', 'التاريخ السابق', 'حفظ المصروف', 'من تاريخ', 'إلى تاريخ', 'Pending Sync']) assert.ok(component.includes(text), `missing UI text: ${text}`)
for (const selector of ['.expense-mode-toggle', '.expense-list-card', '.expense-date-filters', '.expense-form textarea']) assert.ok(styles.includes(selector), `missing UI style: ${selector}`)
assert.match(component, /type="date" max=\{getLocalDateKey\(Date\.now\(\)\)\}/)
assert.match(component, /entryType === 'current'/)
assert.match(component, /fundingSource === 'cashbox'/)
assert.match(component, /تعذر الحفظ، حاول مرة أخرى/)
assert.match(component, /تعذر التحديث، لم يتم تأكيد العملية/)
assert.doesNotMatch(component, /saveLocalExpensePending\(/)
assert.doesNotMatch(component, /announceSuccess\('تم حفظ المصروف محليًا/)
assert.match(component, /expenseListOpen.*useState\(false\)/)
assert.match(component, /aria-expanded=\{expenseListOpen\}/)
assert.match(component, /expenseListOpen \? 'إخفاء' : 'عرض'/)
console.log('EXPENSE_UI_RENDER = PASS')
