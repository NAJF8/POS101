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
  const normalized = normalizeDigits(value).trim()
  // A date-only value is a cashier-local calendar date, not a UTC instant.
  // Construct it with local Date setters so `2026-09-25` cannot shift across
  // midnight when the browser timezone is west of UTC.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (dateOnly) {
    const [, year, month, day] = dateOnly
    const localDate = new Date(0)
    localDate.setHours(0, 0, 0, 0)
    localDate.setFullYear(Number(year), Number(month) - 1, Number(day))
    return Number.isFinite(localDate.getTime()) ? localDate.getTime() : 0
  }
  const parsed = Date.parse(normalized)
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

const localDateFromTimestamp = timestamp => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Operational history uses the immutable business date when available. Legacy
// sales without it remain filterable by their real local createdAt date.
export const businessDateForSale = sale => {
  const explicit = normalizeDigits(String(sale?.businessDate || '').trim())
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit
  return localDateFromTimestamp(dateValue(firstValue(sale?.createdAt, sale?.created_at, sale?.timestamp, sale?.date)))
}

export const businessDateTimestamp = sale => dateValue(businessDateForSale(sale))

export const readLocalSales = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('pos101.sales') || '[]')
    return Array.isArray(raw) ? raw.map(normalizeSale) : []
  } catch {
    return []
  }
}

export const filterReportSales = (sales, { startMs = -Infinity, endMs = Infinity } = {}) => (Array.isArray(sales) ? sales : [])
  .filter(sale => sale.createdAt >= startMs && sale.createdAt <= endMs && !sale.voided)
