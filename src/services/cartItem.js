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
  const name = String(value.name_ar ?? value.name ?? value.label ?? '').trim()
  if (!name) return null
  const id = String(value.id ?? value.key ?? name).trim() || fallbackId
  return { ...value, id, name, price: safeNumber(value.price ?? value.extraPrice ?? value.delta, 0) }
}

export const normalizeOptions = (value, fallbackId = 'option') =>
  asArray(value).map((entry, index) => normalizeOption(entry, `${fallbackId}-${index + 1}`)).filter(Boolean)

export const buildCartItem = (product, lineId) => {
  if (!product || typeof product !== 'object') return { ok: false, error: INVALID_PRICE_MESSAGE }
  const rawPrice = product.unitPrice ?? product.price
  const price = safeNumber(rawPrice, Number.NaN)
  if (!Number.isFinite(price) || price < 0) return { ok: false, error: INVALID_PRICE_MESSAGE }
  const quantity = Math.max(1, safeNumber(product.quantity, 1))

  return {
    ok: true,
    item: {
      ...product,
      price,
      quantity,
      options: normalizeOptions(product.options),
      additions: normalizeOptions(product.additions ?? product.addOns ?? product.addons ?? product.extras, 'addition'),
      addons: normalizeOptions(product.addons ?? product.addOns ?? product.additions, 'addon'),
      flavors: normalizeOptions(product.flavors, 'flavor'),
      variants: normalizeOptions(product.variants, 'variant'),
      sizes: normalizeOptions(product.sizes, 'size'),
      selectedOptions: normalizeOptions(product.selectedOptions, 'selected'),
      lineId,
    },
  }
}

export { INVALID_PRICE_MESSAGE }
