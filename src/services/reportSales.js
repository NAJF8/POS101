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

const CLOSED_SALE_STATUSES = new Set(['cancelled', 'canceled', 'voided', 'abandoned', 'draft', 'باطل', 'ملغي'])
const saleOperationalDayId = sale => String(sale?.operationalDayId || sale?.operational_day_id || sale?.shiftId || sale?.shift_id || '').trim()
const operationalDayId = day => String(day?.operationalDayId || day?.id || '').trim()

export const isReportableSale = sale => {
  const status = String(sale?.status || '').trim().toLowerCase()
  return !sale?.voided && !CLOSED_SALE_STATUSES.has(status)
}

const normalizedOperationalDays = operationalDays => (Array.isArray(operationalDays) ? operationalDays : [])
  .map(day => ({ ...day, id: operationalDayId(day), businessDate: String(day?.businessDate || '').trim() }))
  .filter(day => day.id && /^\d{4}-\d{2}-\d{2}$/.test(day.businessDate))

const centralClosedSalesForDate = (centralSales, date, days) => {
  const closedIds = new Set(days.filter(day => day.businessDate === date && day.status === 'closed').map(day => day.id))
  return (Array.isArray(centralSales) ? centralSales : []).filter(sale => {
    if (!isReportableSale(sale) || businessDateForSale(sale) !== date) return false
    const id = saleOperationalDayId(sale)
    // A closed date is authoritative by operationalDayId. The explicit date
    // fallback is only for legacy central rows that have no day id at all.
    if (id && closedIds.has(id)) return true
    // A recovered central sale can retain the correct businessDate while its
    // legacy operational-day key is absent/stale. Date fallback is safe only
    // when that businessDate has one closed operational day.
    return businessDateForSale(sale) === date && closedIds.size === 1
  })
}

export const getReportSalesForOperationalDay = ({ centralSales = [], operationalDayId = '', businessDate = '' } = {}) => {
  const id = String(operationalDayId || '').trim()
  const date = String(businessDate || '').trim()
  return (Array.isArray(centralSales) ? centralSales : []).filter(sale => {
    if (!isReportableSale(sale)) return false
    const saleDayId = saleOperationalDayId(sale)
    return saleDayId ? saleDayId === id : Boolean(date && businessDateForSale(sale) === date)
  })
}

export const compareReportSalesToSettlement = ({ sales = [], settlement = null } = {}) => {
  const rows = Array.isArray(sales) ? sales : []
  const net = rows.reduce((sum, sale) => sum + numberValue(sale?.total ?? sale?.subtotal), 0)
  return {
    count: rows.length,
    net,
    settlementCount: Number(settlement?.orderCount || 0),
    settlementNet: Number(settlement?.sales || 0),
    drift: Boolean(settlement && (rows.length !== Number(settlement.orderCount || 0) || net !== Number(settlement.sales || 0))),
  }
}

// Closed dates use the central ledger; the active open date may retain local
// pending visibility. This function is shared by screen, print, and financial
// summaries so they cannot silently choose different ledgers.
export const getReportSalesForPeriod = ({ localSales = [], centralSales = [], operationalDays = [], from = '', to = '', currentOperationalDay = null } = {}) => {
  if (!from || !to || from > to) return []
  const days = normalizedOperationalDays(operationalDays)
  const dates = new Set()
  for (const row of [...(Array.isArray(localSales) ? localSales : []), ...(Array.isArray(centralSales) ? centralSales : [])]) {
    const date = businessDateForSale(row)
    if (date >= from && date <= to) dates.add(date)
  }
  for (const day of days) if (day.businessDate >= from && day.businessDate <= to) dates.add(day.businessDate)
  const openId = operationalDayId(currentOperationalDay)
  const result = []
  for (const date of dates) {
    const closedDays = days.filter(day => day.businessDate === date && day.status === 'closed')
    if (closedDays.length) result.push(...centralClosedSalesForDate(centralSales, date, days))
    else if (openId && currentOperationalDay?.businessDate === date) {
      const localRows = (Array.isArray(localSales) ? localSales : []).filter(sale => isReportableSale(sale) && businessDateForSale(sale) === date)
      const centralRows = (Array.isArray(centralSales) ? centralSales : []).filter(sale => isReportableSale(sale) && businessDateForSale(sale) === date)
      const merged = new Map()
      for (const sale of localRows) merged.set(String(sale?.saleId || sale?.id || sale?.operationKey || sale?.orderNumber || ''), sale)
      for (const sale of centralRows) merged.set(String(sale?.saleId || sale?.id || sale?.operationKey || sale?.orderNumber || ''), sale)
      result.push(...merged.values())
    } else {
      result.push(...(Array.isArray(centralSales) ? centralSales : []).filter(sale => isReportableSale(sale) && businessDateForSale(sale) === date))
    }
  }
  return result
}
