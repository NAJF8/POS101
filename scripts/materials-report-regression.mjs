import assert from 'node:assert/strict'
import { buildMaterialsReport } from '../src/services/materialsReport.js'

const result = buildMaterialsReport({
  categories: ['الكل', 'كيك', 'عصائر', 'قهوة ساخنة'],
  products: [
    { id: 'cake-parent', name: 'كيك أساسي', category: 'كيك', categoryId: 'كيك' },
    { id: 'juice', name: 'عصير برتقال', category: 'عصائر', categoryId: 'عصائر' },
    { id: 'variant', name: 'حجم كبير', parentProductId: 'cake-parent' },
  ],
  sales: [{ items: [
    { productId: 'variant', name: 'كيك أساسي - حجم كبير', quantity: 4, price: 5000 },
    { productId: 'juice', name: 'عصير برتقال', quantity: 2, price: 4500 },
  ] }],
})

assert.deepEqual(result.sections.map(section => section.name), ['كيك', 'عصائر'])
assert.equal(result.sections[0].items[0].name, 'كيك أساسي - حجم كبير')
assert.equal(result.sections[0].quantity, 4)
assert.equal(result.sections[0].total, 20_000)
assert.equal(result.sections[1].quantity, 2)
assert.equal(result.sections[1].total, 9_000)
assert.equal(result.grandQuantity, 6)
assert.equal(result.grandTotal, 29_000)
assert.equal(result.sections.some(section => section.name === 'قهوة ساخنة'), false)

console.log('MATERIALS_REPORT_REGRESSION=PASS')
