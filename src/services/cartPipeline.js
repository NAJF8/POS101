import { buildCartItem, normalizeOrder } from './cartItem.js'

const safeText = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

const safeItemSummary = item => ({
  id: safeText(item?.id),
  cartItemId: safeText(item?.cartItemId),
  productId: safeText(item?.productId),
  displayName: safeText(item?.displayName),
  quantity: Number(item?.quantity) || 0,
  unitPrice: Number(item?.unitPrice) || 0,
  total: Number(item?.total) || 0,
  size: safeText(item?.size?.label),
  options: Array.isArray(item?.options) ? item.options.map(option => safeText(option?.label)).filter(Boolean) : [],
  additions: Array.isArray(item?.additions) ? item.additions.map(addition => safeText(addition?.label)).filter(Boolean) : [],
})

export const prepareCartAdd = ({ activeOrder, product, lineId, buildCartItemFn = buildCartItem, normalizeOrderFn = normalizeOrder } = {}) => {
  if (typeof buildCartItemFn !== 'function' || typeof normalizeOrderFn !== 'function') return { ok: false, error: 'تعذر إضافة المنتج بسبب بيانات غير مكتملة', stage: 'helpers' }
  const original = normalizeOrderFn(activeOrder || {})
  const built = buildCartItemFn(product, lineId || `${product?.id || 'product'}-${Date.now()}`)
  if (!built?.ok) return { ok: false, error: built?.error || 'تعذر إضافة المنتج بسبب بيانات غير مكتملة', stage: 'build', original }
  const item = built.item
  const variantLine = item.variantId || item.childProductId
  const existing = variantLine
    ? original.items.find(current => String(current.variantId || current.childProductId || '') === String(variantLine))
    : null
  const nextItems = existing
    ? original.items.map(current => current === existing ? { ...current, quantity: current.quantity + (item.quantity || 1) } : current)
    : [...original.items, item]
  const nextOrder = normalizeOrderFn({ ...original, items: nextItems })
  if (!Array.isArray(nextOrder.items) || nextOrder.items.some(entry => !entry?.displayName || !Array.isArray(entry.options) || !Array.isArray(entry.additions) || !Number.isFinite(Number(entry.price)) || !Number.isFinite(Number(entry.total)))) {
    return { ok: false, error: 'تعذر إضافة المنتج بسبب بيانات غير مكتملة', stage: 'normalize', original, item }
  }
  return {
    ok: true,
    item,
    nextOrder,
    merged: Boolean(existing),
    itemSummary: safeItemSummary(item),
    orderSummary: { itemCount: nextOrder.items.length, total: nextOrder.items.reduce((sum, entry) => sum + Number(entry.total || 0), 0) },
  }
}

export const buildRealOptionsAddTest = ({ activeOrder, product, buildCartItemFn = buildCartItem, normalizeOrderFn = normalizeOrder } = {}) => {
  const result = prepareCartAdd({
    activeOrder,
    product: { ...product, quantity: 1, size: { id: 'size-عادي', label: 'عادي', name: 'عادي', priceDelta: 0 }, options: [{ id: 'size-عادي', label: 'عادي', name: 'عادي', priceDelta: 0 }], additions: [], selectedOptions: ['عادي'], unitPrice: product?.price },
    lineId: 'safe-real-options-test',
    buildCartItemFn,
    normalizeOrderFn,
  })
  return { ...result, mode: 'no-save', stateMutation: 'SKIPPED', firebaseWrites: 0, localStorageWrites: 0, modalClose: 'SKIPPED' }
}
