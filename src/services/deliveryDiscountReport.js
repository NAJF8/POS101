import { businessDateForSale, isReportableSale, normalizeSale, numberValue } from './reportSales.js'

const sourceText = value => String(value ?? '').trim().toLocaleLowerCase()
const sourceFields = sale => [
  sale?.deliverySource, sale?.source, sale?.orderSource, sale?.channel, sale?.orderChannel,
  sale?.order?.deliverySource, sale?.order?.source, sale?.order?.orderSource, sale?.order?.channel,
  sale?.order?.orderType, sale?.orderType,
]

export const deliverySourceOf = sale => {
  const value = sourceFields(sale).map(sourceText).find(Boolean) || ''
  if (/(baly|bly|بلي|بلى)/i.test(value)) return 'baly'
  if (/(toters|totter|توترز|توتـرز|تويترز)/i.test(value)) return 'toters'
  return ''
}

export const deliverySourceLabel = source => source === 'baly' ? 'بلي' : source === 'toters' ? 'توترز' : 'غير محدد'

export const buildDeliveryDiscountReport = (sales, { from = '', to = '', source = 'all' } = {}) => {
  const rows = (Array.isArray(sales) ? sales : []).map(normalizeSale).filter(sale => {
    const detected = deliverySourceOf(sale)
    const date = businessDateForSale(sale)
    return isReportableSale(sale) && detected && (!from || date >= from) && (!to || date <= to) && (source === 'all' || detected === source)
  }).map(sale => {
    const discount = numberValue(sale.discount)
    const finalTotal = numberValue(sale.total)
    const originalTotal = Math.max(0, numberValue(sale.subtotal, finalTotal + discount))
    return {
      id: sale.id || sale.saleId || sale.operationKey || sale.orderNumber,
      sale,
      businessDate: businessDateForSale(sale),
      orderNumber: sale.orderNumber || '—',
      source: deliverySourceOf(sale),
      sourceLabel: deliverySourceLabel(deliverySourceOf(sale)),
      originalTotal,
      discount,
      discountPercent: originalTotal ? (discount / originalTotal) * 100 : 0,
      finalTotal,
      paymentMethod: sale.paymentMethod,
      cashier: sale.cashierNameSnapshot || sale.cashierName || sale.seller || sale.shift || '—',
      createdAt: sale.createdAt,
    }
  }).sort((a, b) => `${b.businessDate}-${b.createdAt}`.localeCompare(`${a.businessDate}-${a.createdAt}`))
  const summarize = list => ({ count: list.length, originalTotal: list.reduce((sum, row) => sum + row.originalTotal, 0), discount: list.reduce((sum, row) => sum + row.discount, 0), finalTotal: list.reduce((sum, row) => sum + row.finalTotal, 0) })
  return { rows, totals: { baly: summarize(rows.filter(row => row.source === 'baly')), toters: summarize(rows.filter(row => row.source === 'toters')), overall: summarize(rows) } }
}
