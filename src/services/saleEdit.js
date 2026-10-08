const number = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const saleEditableSnapshot = sale => ({
  saleId: sale?.saleId || sale?.id || '', orderNumber: sale?.orderNumber || '', operationalDayId: sale?.operationalDayId || '', businessDate: sale?.businessDate || '',
  orderType: sale?.orderType || sale?.order?.orderType || '', paymentMethod: sale?.paymentMethod || '', discount: number(sale?.discount), subtotal: number(sale?.subtotal), total: number(sale?.total),
  note: sale?.customerNote ?? sale?.orderNote ?? sale?.cashierNote ?? sale?.note ?? sale?.notes ?? '', cashier: sale?.cashierNameSnapshot || sale?.cashierName || sale?.seller || '', adminNote: sale?.adminNote || sale?.editNote || '',
})

export const buildSaleEditPatch = (sale, changes = {}) => {
  const subtotal = number(sale?.subtotal || number(sale?.total) + number(sale?.discount))
  const discount = Math.min(subtotal, Math.max(0, number(changes.discount)))
  const patch = { subtotal, discount, total: subtotal - discount, paymentMethod: changes.paymentMethod || sale.paymentMethod, orderType: changes.orderType || sale.orderType || sale.order?.orderType || null }
  const noteKey = ['customerNote', 'orderNote', 'cashierNote', 'note', 'notes'].find(key => sale?.[key] !== undefined) || 'customerNote'
  patch[noteKey] = String(changes.note ?? '')
  patch.cashierNameSnapshot = String(changes.cashier ?? sale?.cashierNameSnapshot ?? sale?.cashierName ?? sale?.seller ?? '')
  patch.adminNote = String(changes.adminNote ?? sale?.adminNote ?? sale?.editNote ?? '')
  return patch
}

export const saleEditPreservesIdentity = (before, after) => ['id', 'saleId', 'operationKey', 'orderNumber', 'operationalDayId', 'businessDate', 'items'].every(key => JSON.stringify(before?.[key] ?? null) === JSON.stringify(after?.[key] ?? null))

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)
const firstArray = values => values.find(value => Array.isArray(value)) || []
export const soldItemsSnapshot = sale => firstArray([
  sale?.items, sale?.cart, sale?.products, sale?.orderItems, sale?.lines,
  sale?.order?.items, sale?.order?.cart, sale?.order?.products, sale?.order?.orderItems, sale?.order?.lines,
])

const itemNumber = (item, keys, fallback = 0) => {
  const key = keys.find(candidate => item?.[candidate] !== undefined)
  return key ? number(item[key]) : fallback
}

const correctionItem = (item, index, source = {}) => {
  const quantity = itemNumber(source, ['quantity', 'qty', 'count'], itemNumber(item, ['quantity', 'qty', 'count']))
  const unitPrice = itemNumber(source, ['unitPrice', 'unit_price', 'price', 'amount'], itemNumber(item, ['unitPrice', 'unit_price', 'price', 'amount']))
  const next = { ...item, quantity, price: unitPrice }
  if (hasOwn(item, 'unitPrice')) next.unitPrice = unitPrice
  if (hasOwn(item, 'unit_price')) next.unit_price = unitPrice
  if (hasOwn(item, 'amount')) next.amount = unitPrice
  const lineTotal = quantity * unitPrice
  if (hasOwn(item, 'lineTotal')) next.lineTotal = lineTotal
  if (hasOwn(item, 'line_total')) next.line_total = lineTotal
  if (hasOwn(item, 'total')) next.total = lineTotal
  return { ...next, _correctionIndex: index }
}

const setExisting = (patch, sale, keys, value) => keys.forEach(key => { if (hasOwn(sale, key)) patch[key] = value })

const paymentPatch = (patch, sale, total, paymentMethod) => {
  const method = paymentMethod || sale?.paymentMethod
  const updateAmountFields = target => {
    if (!target || typeof target !== 'object') return
    const split = ['cashAmount', 'cash', 'electronicAmount', 'electronic', 'cardAmount', 'card'].some(key => hasOwn(target, key))
    if (!split) ['amount', 'total', 'finalTotal', 'grandTotal', 'netTotal'].forEach(key => { if (hasOwn(target, key)) target[key] = total })
    else if (method === 'cash') ['cashAmount', 'cash'].forEach(key => { if (hasOwn(target, key)) target[key] = total })
    else if (method === 'electronic' || method === 'card') ['electronicAmount', 'electronic', 'cardAmount', 'card'].forEach(key => { if (hasOwn(target, key)) target[key] = total })
  }
  if (sale?.payment && typeof sale.payment === 'object') { patch.payment = { ...sale.payment }; updateAmountFields(patch.payment) }
  if (method === 'cash') ['cashAmount', 'cash'].forEach(key => { if (hasOwn(sale, key)) patch[key] = total })
  if (method === 'electronic' || method === 'card') ['electronicAmount', 'electronic', 'cardAmount', 'card'].forEach(key => { if (hasOwn(sale, key)) patch[key] = total })
}

export const correctionTotalsSnapshot = sale => ({
  subtotal: number(sale?.subtotal ?? sale?.totalBeforeDiscount ?? sale?.originalTotal),
  discount: number(sale?.discount ?? sale?.discountAmount),
  total: number(sale?.total ?? sale?.finalTotal ?? sale?.grandTotal ?? sale?.netTotal),
})

export const buildSaleItemCorrectionPatch = (sale, changes = {}) => {
  const requestedItems = Array.isArray(changes.items) ? changes.items : soldItemsSnapshot(sale)
  if (!requestedItems.length) throw Object.assign(new Error('لا يمكن حذف جميع المنتجات من طلب مكتمل. استخدم إلغاء/تصحيح إداري منفصل.'), { code: 'SALE_CORRECTION_ALL_ITEMS_DELETED' })
  const items = requestedItems.map((source, index) => {
    const original = soldItemsSnapshot(sale)[Number.isInteger(source?._originalIndex) ? source._originalIndex : index] || source
    const next = correctionItem(original, index, source)
    if (!Number.isFinite(next.quantity) || next.quantity <= 0) throw Object.assign(new Error('الكمية يجب أن تكون أكبر من صفر.'), { code: 'SALE_CORRECTION_QTY_INVALID' })
    if (!Number.isFinite(next.price) || next.price < 0) throw Object.assign(new Error('السعر يجب أن يكون رقماً لا يقل عن صفر.'), { code: 'SALE_CORRECTION_PRICE_INVALID' })
    delete next._correctionIndex
    return next
  })
  const subtotal = items.reduce((sum, item) => sum + number(item.price) * number(item.quantity), 0)
  const discount = number(changes.discount ?? sale?.discount ?? sale?.discountAmount)
  if (discount < 0 || discount > subtotal) throw Object.assign(new Error('قيمة الخصم غير صالحة.'), { code: 'SALE_DISCOUNT_INVALID' })
  const total = subtotal - discount
  if (total < 0) throw Object.assign(new Error('الإجمالي النهائي لا يمكن أن يكون سالباً.'), { code: 'SALE_CORRECTION_TOTAL_INVALID' })
  const patch = { items, subtotal, discount, total }
  const itemField = ['items', 'cart', 'products', 'orderItems', 'lines'].find(key => Array.isArray(sale?.[key]))
  if (itemField && itemField !== 'items') patch[itemField] = items
  setExisting(patch, sale, ['originalTotal', 'totalBeforeDiscount'], subtotal)
  setExisting(patch, sale, ['discountAmount'], discount)
  setExisting(patch, sale, ['finalTotal', 'grandTotal', 'netTotal'], total)
  paymentPatch(patch, sale, total, changes.paymentMethod || sale?.paymentMethod)
  return patch
}

export const saleCorrectionChangedFields = (before, after) => Object.fromEntries(
  ['items', 'subtotal', 'originalTotal', 'totalBeforeDiscount', 'discount', 'discountAmount', 'total', 'finalTotal', 'grandTotal', 'netTotal', 'payment', 'cashAmount', 'electronicAmount']
    .filter(key => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null))
    .map(key => [key, { before: before?.[key] ?? null, after: after?.[key] ?? null }]),
)
