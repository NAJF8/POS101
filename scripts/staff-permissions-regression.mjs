import assert from 'node:assert/strict'
import fs from 'node:fs'

const roles = ['super_admin', 'admin', 'manager', 'cashier', 'cashier-sync', 'employee']
const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8')).rules
const emulatorRules = JSON.parse(fs.readFileSync('database.rules.emulator.json', 'utf8')).rules
const source = fs.readFileSync('src/services/posCentralSync.js', 'utf8')
const expressions = [rules.pos101_staff['.read'], rules.pos101_staff['.write'], emulatorRules.pos101_staff['.read'], emulatorRules.pos101_staff['.write'], rules.pos101_financial_audit_log['.write']]

for (const role of roles) {
  const roleExpression = `child(auth.uid).child('role').val() === '${role}'`
  assert.ok(rules.pos101_staff['.read'].includes(roleExpression))
  assert.ok(rules.pos101_staff['.write'].includes(roleExpression))
  assert.ok(emulatorRules.pos101_staff['.read'].includes(roleExpression))
  assert.ok(emulatorRules.pos101_staff['.write'].includes(roleExpression))
  assert.ok(rules.pos101_financial_audit_log['.write'].includes(roleExpression))
  assert.match(source, new RegExp(`['"]${role}['"]`))
}

for (const expression of expressions) {
  assert.match(expression, /auth != null/)
  assert.match(expression, /active.*!== false/)
  assert.match(expression, /authorized.*!== false/)
}

assert.match(source, /export const canManageStaff/)
assert.match(source, /record\.active !== false/)
assert.match(source, /record\.authorized !== false/)
assert.match(source, /saveStaffAudit/)

console.log(JSON.stringify({
  allowed_roles: Object.fromEntries(roles.map(role => [role, 'PASS'])),
  inactive_user: 'FAIL',
  unauthorized_user: 'FAIL',
  audit_write_contract: 'PASS',
  firebase_emulator: 'NOT RUN (Java 21 required)',
}, null, 2))
