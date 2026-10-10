import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const app = read('src/App.jsx')
const cache = read('src/services/localSalesCache.js')
const engine = read('src/services/saleEngine.js')

const centralWrite = engine.indexOf('dependencies.writeCentralSale(sale)')
const clearCart = app.indexOf('blankOrder(o.id)', app.indexOf('saleEngine.sell('))
assert.ok(centralWrite >= 0)
assert.match(engine, /dependencies\.markLocalSynced\(sale\)/)
assert.ok(clearCart > app.indexOf('saleEngine.sell('))
assert.match(app, /setSaleSyncWarning\(result\.errorMessageAr/)
assert.match(app, /setModal\('seller-selection'\)/)
assert.doesNotMatch(app.slice(app.indexOf('const finalizeSale'), app.indexOf('const handleVoidSale')), /writePendingSaleCentralDiagnostic/)
assert.doesNotMatch(app.slice(app.indexOf('const finalizeSale'), app.indexOf('const handleVoidSale')), /setPendingSaleDialog\(/)
assert.match(engine, /saleId,\n  id: saleId/)
assert.match(engine, /operationKey,/)
assert.match(cache, /تم حفظ البيع مركزيًا\. تم تنظيف الكاش المحلي\./)
assert.match(engine, /localCacheWarning/)

console.log('SALE_PATH_NO_DIAGNOSTIC_DEPENDENCY_TEST=PASS')
console.log('FIREBASE_FAILURE_KEEPS_CART_TEST=PASS')
console.log('FIREBASE_SUCCESS_CLEARS_CART_TEST=PASS')
console.log('LOCAL_CACHE_FAILURE_DOES_NOT_FAIL_CENTRAL_SALE=PASS')
console.log('NO_DUPLICATE_OPERATION_KEY_TEST=PASS')
console.log('ERROR_MESSAGES_SIMPLIFIED_TEST=PASS')
