const INVALID_PRICE_MESSAGE = 'تعذر إضافة المنتج: السعر غير صالح'
const INCOMPLETE_ITEM_LABEL = 'منتج غير مكتمل البيانات'

export const safeText = (value, fallback = '') => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim()
    return text || fallback
  }
  return fallback
}

export const safeNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export const asArray = value => Array.isArray(value) ? value : []

export const safeFormatMoney = value => {
  const amount = safeNumber(value)
  try { return `${new Intl.NumberFormat('ar-IQ').format(amount)} د.ع` } catch { return `${amount} د.ع` }
}

const firstText = (...values) => values.map(value => safeText(value)).find(Boolean) || ''

const optionId = (value, fallbackId) => safeText(value?.id ?? value?.key ?? value?.value, fallbackId) || fallbackId

export const getOptionLabel = value => {
  if (typeof value === 'string' || typeof value === 'number') return safeText(value)
  if (!value || typeof value !== 'object') return ''
  return firstText(value.label, value.name_ar, value.nameAr, value.name, value.title, value.value, value.id)
}

export const getSizeLabel = size => getOptionLabel(size)
export const getAdditionLabel = addition => getOptionLabel(addition)

const normalizeOption = (value, fallbackId = 'option') => {
  const label = getOptionLabel(value)
  if (!label) return null
  const raw = value && typeof value === 'object' ? value : {}
  const price = safeNumber(raw.price ?? raw.extraPrice ?? raw.priceDelta ?? raw.delta, 0)
  return {
    id: optionId(raw, `${fallbackId}-${label}`),
    label,
    name: label,
    price,
    priceDelta: safeNumber(raw.priceDelta ?? raw.extraPrice ?? raw.delta ?? raw.price, price),
  }
}

export const normalizeOptions = (value, fallbackId = 'option') =>
  asArray(value).map((entry, index) => normalizeOption(entry, `${fallbackId}-${index + 1}`)).filter(Boolean)

const normalizeSize = value => {
  if (value === null || value === undefined || value === '') return null
  const normalized = normalizeOption(value, 'size')
  return normalized ? { ...normalized, priceDelta: safeNumber(normalized.priceDelta, 0) } : null
}

const safeMeta = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const meta = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean' || entry === null) meta[key] = entry
  }
  return meta
}

export const normalizeCartItem = (rawItem, fallbackLineId = 'cart-item') => {
  const raw = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem : {}
  const productId = safeText(raw.productId ?? raw.id ?? raw.product?.id, fallbackLineId) || fallbackLineId
  const id = safeText(raw.id ?? raw.productId, productId) || productId
  const lineId = safeText(raw.cartItemId ?? raw.lineId, `${fallbackLineId}-${productId}`) || `${fallbackLineId}-${productId}`
  const price = Math.max(0, safeNumber(raw.unitPrice ?? raw.price ?? raw.unit_price, 0))
  const basePrice = Math.max(0, safeNumber(raw.basePrice ?? raw.base_price ?? raw.price ?? raw.unitPrice, price))
  const quantityValue = safeNumber(raw.quantity ?? raw.qty ?? raw.count, 1)
  const quantity = quantityValue > 0 ? quantityValue : 1
  const name = firstText(raw.displayName, raw.name_ar, raw.nameAr, raw.name, raw.productName, raw.title) || INCOMPLETE_ITEM_LABEL
  const options = normalizeOptions(raw.options, 'option')
  const additions = normalizeOptions(raw.additions ?? raw.addOns ?? raw.addons ?? raw.extras, 'addition')
  const selectedOptions = normalizeOptions(raw.selectedOptions ?? raw.selected_options, 'selected')
  const size = normalizeSize(raw.size ?? raw.selectedSize ?? raw.selected_size)
  const total = safeNumber(price * quantity, 0)

  return {
    id,
    cartItemId: lineId,
    lineId,
    productId,
    name,
    name_ar: firstText(raw.name_ar, raw.nameAr, name) || INCOMPLETE_ITEM_LABEL,
    displayName: name,
    english: firstText(raw.english, raw.name_en, raw.nameEn),
    category: safeText(raw.category),
    image: safeText(raw.image),
    productType: safeText(raw.productType),
    parentProductId: safeText(raw.parentProductId),
    childProductId: safeText(raw.childProductId),
    variantId: safeText(raw.variantId),
    accProductId: safeText(raw.accProductId),
    quantity,
    unitPrice: price,
    price,
    basePrice,
    total,
    lineTotal: total,
    size,
    options,
    additions,
    selectedOptions,
    addons: normalizeOptions(raw.addons ?? raw.addOns ?? raw.additions, 'addon'),
    flavors: normalizeOptions(raw.flavors, 'flavor'),
    variants: normalizeOptions(raw.variants, 'variant'),
    sizes: normalizeOptions(raw.sizes, 'size'),
    notes: firstText(raw.notes, raw.note),
    note: firstText(raw.note, raw.notes),
    meta: safeMeta(raw.meta),
  }
}

export const normalizeCartItems = items => {
  const usedLineIds = new Set()
  return asArray(items).map((item, index) => {
    const fallback = `cart-item-${index + 1}`
    const normalized = normalizeCartItem(item, fallback)
    let lineId = normalized.lineId
    if (usedLineIds.has(lineId)) lineId = `${lineId}-${index + 1}`
    usedLineIds.add(lineId)
    return lineId === normalized.lineId ? normalized : { ...normalized, lineId, cartItemId: lineId }
  })
}

export const normalizeOrder = rawOrder => ({
  ...(rawOrder && typeof rawOrder === 'object' && !Array.isArray(rawOrder) ? rawOrder : {}),
  items: normalizeCartItems(rawOrder?.items),
})

export const buildCartItem = (product, lineId) => {
  if (!product || typeof product !== 'object' || Array.isArray(product)) return { ok: false, error: INVALID_PRICE_MESSAGE }
  const rawPrice = product.unitPrice ?? product.price ?? product.unit_price
  const price = safeNumber(rawPrice, Number.NaN)
  if (!Number.isFinite(price) || price < 0) return { ok: false, error: INVALID_PRICE_MESSAGE }
  const item = normalizeCartItem({ ...product, price, unitPrice: price, lineId }, lineId || 'cart-item')
  if (!item.displayName || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || !Number.isFinite(item.total) || !Array.isArray(item.options) || !Array.isArray(item.additions)) {
    return { ok: false, error: 'تعذر إضافة المنتج بسبب بيانات غير مكتملة' }
  }
  return { ok: true, item }
}

export { INVALID_PRICE_MESSAGE, INCOMPLETE_ITEM_LABEL }
