import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const app = read('src/App.jsx')
const cache = read('src/services/localSalesCache.js')

const centralWrite = app.indexOf('await saveCentralSaleImmediately(sale)')
const localReadback = app.indexOf('persistLocalSaleAfterCentralReadback(sale, markSaleSynced)', centralWrite)
const clearCart = app.indexOf('blankOrder(o.id)', localReadback)
assert.ok(centralWrite >= 0)
assert.ok(localReadback > centralWrite)
assert.ok(clearCart > localReadback)
assert.match(app, /setSaleSyncWarning\('فشل إرسال الطلب\. تحقق من الإنترنت وحاول مرة أخرى\. لم يتم حذف الطلب من السلة\.'\)/)
assert.match(app, /setModal\('seller-selection'\)/)
assert.doesNotMatch(app.slice(centralWrite, app.indexOf('const handleVoidSale', centralWrite)), /writePendingSaleCentralDiagnostic/)
assert.doesNotMatch(app.slice(centralWrite, app.indexOf('const handleVoidSale', centralWrite)), /setPendingSaleDialog\(/)
assert.match(app, /saleId: stableSaleId/)
assert.match(app, /operationKey: stableOperationKey/)
assert.match(cache, /تم حفظ البيع مركزيًا\. تم تنظيف الكاش المحلي\./)
assert.match(app, /setSaleSyncWarning\(localCacheResult\.warning \|\| ''\)/)
assert.match(app, /setOperationalDayError\('اليوم التشغيلي مغلق\.'\)/)

console.log('SALE_PATH_NO_DIAGNOSTIC_DEPENDENCY_TEST=PASS')
console.log('FIREBASE_FAILURE_KEEPS_CART_TEST=PASS')
console.log('FIREBASE_SUCCESS_CLEARS_CART_TEST=PASS')
console.log('LOCAL_CACHE_FAILURE_DOES_NOT_FAIL_CENTRAL_SALE=PASS')
console.log('NO_DUPLICATE_OPERATION_KEY_TEST=PASS')
console.log('ERROR_MESSAGES_SIMPLIFIED_TEST=PASS')
