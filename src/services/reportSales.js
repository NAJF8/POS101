const ARABIC_DIGITS = String.raw`٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹`

const normalizeDigits = value => String(value ?? '').replace(/[٠-٩۰-۹]/g, digit => {
  const index = ARABIC_DIGITS.indexOf(digit)
  return index >= 10 ? String(index - 10) : String(index)
})

export const numberValue = (value, fallback = 0) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  const normalized = normalizeDigits(value).replace(/[٬,]/g, '').replace('٫', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : fallback
}

// End of report sales helpers.
export const dateValue = value => {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number' || /^\s*[٠-٩۰-۹\d]+\s*$/.test(String(value))) {
    const numeric = numberValue(value)
    if (!numeric) return 0
    return numeric < 1e12 ? numeric * 1000 : numeric
  }
  const parsed = Date.parse(normalizeDigits(value))
  return Number.isFinite(parsed) ? parsed : 0
}

const firstValue = (...values) => values.find(value => value !== undefined && value !== null && value !== '')

export const normalizeSale = sale => {
  const order = sale?.order || {}
  const payment = sale?.payment || {}
  const discount = firstValue(sale?.discount, sale?.discount_amount, order.discount?.value, 0)
  const subtotal = firstValue(sale?.subtotal, order.subtotal, sale?.total, sale?.total_after_discount, 0)
  const total = firstValue(sale?.total, sale?.total_after_discount, sale?.net_total, numberValue(subtotal) - numberValue(discount), 0)
  return {
    ...sale,
    id: firstValue(sale?.id, sale?.saleId),
    createdAt: dateValue(firstValue(sale?.createdAt, sale?.created_at, sale?.timestamp, sale?.date)),
    subtotal: numberValue(subtotal),
    discount: numberValue(discount),
    total: numberValue(total),
    service: numberValue(firstValue(sale?.service, sale?.service_charge, sale?.serviceCharge, 0)),
    paymentMethod: firstValue(sale?.paymentMethod, sale?.payment_method, payment.method, 'cash'),
    shift: firstValue(sale?.shift, sale?.shiftName, sale?.shift_id),
    voided: Boolean(sale?.voided || sale?.status === 'voided'),
    order: { ...order, items: sale?.items || order.items || [] },
  }
}
export const readLocalSales = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('pos101.sales') || '[]')
    return Array.isArray(raw) ? raw.map(normalizeSale) : []
  } catch {
    return []
  }
}
