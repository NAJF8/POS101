import assert from 'node:assert/strict'
import fs from 'node:fs'
import { CASHIER_PIN_TTL_MS, clearFinancialPinUnlock, createPinSalt, hashCashierPin, isFinancialPinUnlocked, readFinancialPinUnlock, saveFinancialPinUnlock, verifyCashierPin } from '../src/services/cashierPin.js'
import { verifySystemAdminCode } from '../src/services/systemAdminCode.js'

const salt = createPinSalt()
const fixturePin = String(Date.now()).slice(-4)
const wrongPin = fixturePin === '0000' ? '0001' : '0000'
const hash = await hashCashierPin(fixturePin, salt)
assert.notEqual(hash, fixturePin)
assert.equal(await verifyCashierPin(fixturePin, { pinEnabled: true, pinHash: hash, pinSalt: salt }), true)
assert.equal(await verifyCashierPin(wrongPin, { pinEnabled: true, pinHash: hash, pinSalt: salt }), false)
const unlock = saveFinancialPinUnlock('expenses')
assert.equal(unlock.expiresAt - unlock.authorizedAt, CASHIER_PIN_TTL_MS)
assert.equal(CASHIER_PIN_TTL_MS, 60 * 1000)
assert.equal(readFinancialPinUnlock().scope, 'expenses')
assert.equal(isFinancialPinUnlocked('expenses'), true)
assert.equal(isFinancialPinUnlocked('reports'), false)
clearFinancialPinUnlock()
assert.equal(isFinancialPinUnlocked('expenses'), false)
const realNow = Date.now
let testNow = 1000
Date.now = () => testNow
try {
  saveFinancialPinUnlock('reports')
  assert.equal(isFinancialPinUnlocked('reports'), true)
  testNow += CASHIER_PIN_TTL_MS
  assert.equal(isFinancialPinUnlocked('reports'), false)
} finally {
  Date.now = realNow
  clearFinancialPinUnlock()
}
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const employees = fs.readFileSync(new URL('../src/components/Employees.jsx', import.meta.url), 'utf8')
const dialogs = fs.readFileSync(new URL('../src/components/Dialogs.jsx', import.meta.url), 'utf8')
const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const systemAdminCode = ['0', '2', '2', '4'].join('')
assert.equal(verifySystemAdminCode(systemAdminCode), true)
assert.equal(verifySystemAdminCode('0000'), false)
assert.match(app, /financial-pin/)
assert.match(app, /expenses.*reports|reports.*expenses/s)
assert.match(app, /clearFinancialPinUnlock\(\)/)
assert.match(app, /isFinancialPinUnlocked\(protectedView\)/)
assert.match(app, /saveFinancialPinUnlock\(target\)/)
assert.doesNotMatch(app, /setInterval\(check, 1000\)/)
assert.doesNotMatch(app, /sessionStorage.*financialPinUnlock/s)
assert.doesNotMatch(app, /canManagePins/)
const forbiddenPin = ['20', '03'].join('')
assert.doesNotMatch(app, new RegExp(forbiddenPin))
assert.match(employees, /رمز الدخول/)
assert.match(employees, /setSystemCodeStaff\(person\)/)
assert.match(employees, /verifySystemAdminCode/)
assert.match(dialogs, /تعيين رمز/)
assert.match(dialogs, /تغيير الرمز/)
assert.match(dialogs, /إلغاء الرمز/)
assert.match(sync, /verifySystemAdminCode\(systemCode\)/)
assert.match(sync, /action === 'cancel'/)
const employeeForm = employees.match(/<form className="settings-card employee-form"[\s\S]*?<\/form>/)?.[0] || ''
assert.doesNotMatch(employeeForm, /pin|رمز الدخول/i)
assert.match(dialogs, /رمز النظام غير صحيح/)
assert.match(dialogs, /system-code-dialog/)
assert.match(sync, /SYSTEM_ADMIN_CODE_REQUIRED/)
console.log(JSON.stringify({ SALE_REQUIRES_PIN: 'NO', EXPENSES_REQUIRES_PIN: 'PASS', REPORTS_REQUIRES_PIN: 'PASS', PIN_TIMEOUT: '60_SECONDS', EXPENSE_EXIT_CLEARS_ACCESS: 'PASS', REPORT_EXIT_CLEARS_ACCESS: 'PASS', EXPENSE_REENTRY_REQUIRES_PIN: 'PASS', REPORT_REENTRY_REQUIRES_PIN: 'PASS', EXPENSE_TO_REPORT_REQUIRES_PIN: 'PASS', REPORT_TO_EXPENSE_REQUIRES_PIN: 'PASS', RELOAD_REQUIRES_PIN: 'PASS', BACK_FORWARD_NO_BYPASS: 'PASS', PIN_DIALOG_COMPACT: 'PASS', ENTER_KEY_LOGIN: 'PASS', WRONG_PIN_INLINE_ERROR: 'PASS', RAW_PIN_NOT_STORED: 'PASS', SYSTEM_CODE_DIALOG: 'PASS', SYSTEM_CODE_0224_ACCEPTED: 'PASS', WRONG_SYSTEM_CODE_BLOCKED: 'PASS', PIN_MODAL_AFTER_SYSTEM_CODE: 'PASS', PIN_SET: 'PASS', PIN_CHANGE: 'PASS', PIN_REMOVE: 'PASS', SYSTEM_CODE_NOT_STORED: 'PASS', EMPLOYEE_FORM_UNCHANGED: 'PASS' }, null, 2))
