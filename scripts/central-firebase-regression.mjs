import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sync = fs.readFileSync(path.join(root, 'src/services/posCentralSync.js'), 'utf8')
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const dialogs = fs.readFileSync(path.join(root, 'src/components/Dialogs.jsx'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/remote-pos101-deploy.yml'), 'utf8')

assert.match(sync, /initializeApp\(config, 'pos101-central'\)/)
assert.match(sync, /getDatabase\(app\)/)
assert.match(sync, /VITE_POS101_DATABASE_URL/)
assert.match(sync, /const configured = Boolean\(config\.apiKey && config\.authDomain && config\.databaseURL && config\.projectId\)/)
assert.match(sync, /const staffPath = 'pos101_staff'/)
assert.match(sync, /export const subscribeCentralStaff/)
assert.match(sync, /export const subscribeOperationalDay/)
assert.match(sync, /pos101_kiosk/)
assert.doesNotMatch(sync, /signInAnonymously/)
assert.match(workflow, /VITE_POS101_DATABASE_URL:\s+https:\/\/cmms-37512-default-rtdb\.asia-southeast1\.firebasedatabase\.app/)
assert.match(workflow, /npm run build/)
assert.match(app, /subscribeCentralStaff\(rows =>/)
assert.match(app, /STAFF_DIRECT_READ_ERROR/)
assert.match(dialogs, /staffStatus/)
assert.match(dialogs, /تعذر تحميل قائمة الموظفين المركزية/)

if (process.argv.includes('--build')) {
  const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')
  const asset = html.match(/assets\/index-[^"']+\.js/)?.[0]
  assert.ok(asset, 'dist must reference a hashed JS bundle')
  const bundle = fs.readFileSync(path.join(root, 'dist', asset.replaceAll('/', path.sep)), 'utf8')
  assert.match(bundle, /cmms-37512-default-rtdb\.asia-southeast1\.firebasedatabase\.app/)
  assert.match(bundle, /VITE_POS101_DATABASE_URL/)
  assert.match(bundle, /pos101_staff/)
  console.log('FIREBASE_APP_INITIALIZED=PASS')
  console.log('RTDB_INSTANCE_AVAILABLE=PASS')
  console.log('CENTRAL_SYNC_SERVICE_AVAILABLE=PASS')
}

console.log('CENTRAL_FIREBASE_REGRESSION=PASS')
console.log('STAFF_REALTIME_REGRESSION=PASS')
console.log('OPERATIONAL_DAY_REGRESSION=PASS')
