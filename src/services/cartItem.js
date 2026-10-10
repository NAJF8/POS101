const INVALID_PRICE_MESSAGE = 'تعذر إضافة المنتج: السعر غير صالح'

export const buildCartItem = (product, lineId) => {
  if (!product || typeof product !== 'object') return { ok: false, error: INVALID_PRICE_MESSAGE }
  const rawPrice = product.unitPrice ?? product.price
  const price = Number(rawPrice)
  if (!Number.isFinite(price) || price < 0) return { ok: false, error: INVALID_PRICE_MESSAGE }

  return {
    ok: true,
    item: {
      ...product,
      price,
      options: Array.isArray(product.options) ? product.options : [],
      lineId,
    },
  }
}

export { INVALID_PRICE_MESSAGE }
