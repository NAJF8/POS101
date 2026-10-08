import assert from 'node:assert/strict'
import fs from 'node:fs'

const sync = fs.readFileSync(new URL('../src/services/posCentralSync.js', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const ui = fs.readFileSync(new URL('../src/components/OperationalDay.jsx', import.meta.url), 'utf8')
const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules

assert.match(sync, /get\(financialPath\(`pos101_operational_days\/\$\{id\}`\)\)/)
assert.match(sync, /get\(financialPath\(`\$\{settlementPath\}\/\$\{key\}`\)\)/)
assert.match(sync, /get\(financialPath\(`\$\{cashboxTransactionsPath\}\/\$\{cashboxId\}`\)\)/)
assert.match(sync, /get\(financialPath\(`\$\{auditPath\}\/\$\{auditId\}`\)\)/)
assert.match(sync, /await update\(ref\(db\), updates\)/)
assert.match(sync, /DAY_CLOSE_READBACK_FAILED/)
assert.match(sync, /DAY_CLOSE_INCONSISTENT/)
assert.doesNotMatch(sync, /if \(existing\.exists\(\)\) return \{ settlement: existing\.val\(\), day: \{ \.\.\.day, status: 'closed' \}/)
assert.match(app, /const reopened = await readOpenOperationalDay\(\)/)
assert.match(app, /setOperationalDay\(result\.day \|\| reopened/)
assert.match(ui, /const closeDisabled = busy \|\| actualCash === '' \|\| preCloseGuard\?\.loading \|\| preCloseGuard\?\.allowed === false/)
assert.match(ui, /disabled=\{closeDisabled\}/)
assert.match(rules.pos101_cashbox_settlements['.read'], /auth\.token\.pos101_kiosk === true/)
assert.match(rules.pos101_cashbox_settlements['.write'], /child\('active'\)\.val\(\) === true/)

console.log('OPERATIONAL_DAY_CLOSE_REGRESSION=PASS')
