const INVALID_PRICE_MESSAGE = 'تعذر إضافة المنتج: السعر غير صالح'

export const asArray = value => Array.isArray(value) ? value : []

export const safeNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export const normalizeOption = (value, fallbackId = 'option') => {
  if (typeof value === 'string') {
    const name = value.trim()
    return name ? { id: `${fallbackId}-${name}`, name, price: 0 } : null
  }
  if (!value || typeof value !== 'object') return null
  const id = String(value.id ?? value.key ?? value.value ?? fallbackId).trim() || fallbackId
  const name = String(value.name_ar ?? value.name ?? value.label ?? value.title ?? value.value ?? id).trim()
  return { ...value, id, name, price: safeNumber(value.price ?? value.extraPrice ?? value.delta, 0) }
}

export const normalizeOptions = (value, fallbackId = 'option') =>
  asArray(value).map((entry, index) => normalizeOption(entry, `${fallbackId}-${index + 1}`)).filter(Boolean)

export const getOptionLabel = value => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  return String(value.name_ar ?? value.name ?? value.label ?? value.title ?? value.value ?? value.id ?? '').trim()
}

export const normalizeCartItem = (rawItem, fallbackLineId = 'cart-item') => {
  const raw = rawItem && typeof rawItem === 'object' ? rawItem : {}
  const id = String(raw.id ?? raw.productId ?? fallbackLineId).trim() || fallbackLineId
  const lineId = String(raw.lineId ?? `${fallbackLineId}-${id}`).trim() || `${fallbackLineId}-${id}`
  const price = safeNumber(raw.unitPrice ?? raw.price, 0)
  const basePrice = safeNumber(raw.basePrice ?? raw.price ?? raw.unitPrice, price)
  const quantity = Math.max(1, safeNumber(raw.quantity, 1))
  return {
    ...raw,
    id,
    productId: String(raw.productId ?? id),
    name: getOptionLabel(raw.name ?? raw.nameAr ?? raw.name_ar),
    price,
    basePrice,
    quantity,
    total: safeNumber(price * quantity, 0),
    options: normalizeOptions(raw.options),
    additions: normalizeOptions(raw.additions ?? raw.addOns ?? raw.addons ?? raw.extras, 'addition'),
    addons: normalizeOptions(raw.addons ?? raw.addOns ?? raw.additions, 'addon'),
    flavors: normalizeOptions(raw.flavors, 'flavor'),
    variants: normalizeOptions(raw.variants, 'variant'),
    sizes: normalizeOptions(raw.sizes, 'size'),
    selectedOptions: normalizeOptions(raw.selectedOptions, 'selected'),
    note: getOptionLabel(raw.note ?? raw.notes),
    lineId,
  }
}

export const normalizeCartItems = items => asArray(items).map((item, index) => normalizeCartItem(item, `cart-item-${index + 1}`))

export const normalizeOrder = rawOrder => ({
  ...(rawOrder && typeof rawOrder === 'object' ? rawOrder : {}),
  items: normalizeCartItems(rawOrder?.items),
})

export const buildCartItem = (product, lineId) => {
  if (!product || typeof product !== 'object') return { ok: false, error: INVALID_PRICE_MESSAGE }
  const rawPrice = product.unitPrice ?? product.price
  const price = safeNumber(rawPrice, Number.NaN)
  if (!Number.isFinite(price) || price < 0) return { ok: false, error: INVALID_PRICE_MESSAGE }
  const quantity = Math.max(1, safeNumber(product.quantity, 1))

  return {
    ok: true,
    item: normalizeCartItem({ ...product, price, quantity, lineId }, lineId || 'cart-item'),
  }
}

export { INVALID_PRICE_MESSAGE }
