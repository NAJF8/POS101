const VOIDED_STATUSES = new Set(['voided', 'cancelled', 'canceled', 'abandoned'])

const text = value => String(value ?? '').trim()
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const saleIdOf = sale => text(sale?.saleId || sale?.id)

export const isActiveOrderNumberSale = sale => !VOIDED_STATUSES.has(text(sale?.status).toLowerCase())

export const buildOrderNumberDuplicateReport = (sales = []) => {
  const groups = new Map()
  for (const sale of sales || []) {
    if (!isActiveOrderNumberSale(sale)) continue
    const orderNumber = text(sale?.orderNumber)
    if (!orderNumber) continue
    if (!groups.has(orderNumber)) groups.set(orderNumber, [])
    groups.get(orderNumber).push({
      saleId: saleIdOf(sale),
      orderNumber: sale.orderNumber,
      businessDate: text(sale?.businessDate),
      operationalDayId: text(sale?.operationalDayId || sale?.operational_day_id),
      total: number(sale?.total ?? sale?.subtotal),
      status: text(sale?.status) || 'active',
    })
  }
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([orderNumber, rows]) => ({
      orderNumber,
      saleIds: rows.map(row => row.saleId),
      records: rows,
      recommendation: 'manual accounting review, no auto repair',
    }))
}

export const findActiveOrderNumberCollision = (sale, centralSales = []) => {
  const orderNumber = text(sale?.orderNumber)
  const saleId = saleIdOf(sale)
  if (!orderNumber) return null
  return (centralSales || []).find(candidate => isActiveOrderNumberSale(candidate)
    && text(candidate?.orderNumber) === orderNumber
    && saleIdOf(candidate) !== saleId) || null
}

export const nextCentralOrderNumber = ({ day = null, centralSales = [] } = {}) => {
  const highestCentral = (centralSales || []).reduce((max, sale) => Math.max(max, number(sale?.orderNumber)), 0)
  const counter = number(day?.nextOrderNumber)
  return Math.max(1, highestCentral + 1, counter)
}

