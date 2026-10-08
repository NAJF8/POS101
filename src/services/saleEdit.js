const number = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const saleEditableSnapshot = sale => ({
  saleId: sale?.saleId || sale?.id || '', orderNumber: sale?.orderNumber || '', operationalDayId: sale?.operationalDayId || '', businessDate: sale?.businessDate || '',
  orderType: sale?.orderType || sale?.order?.orderType || '', paymentMethod: sale?.paymentMethod || '', discount: number(sale?.discount), subtotal: number(sale?.subtotal), total: number(sale?.total),
  note: sale?.customerNote ?? sale?.orderNote ?? sale?.cashierNote ?? sale?.note ?? sale?.notes ?? '', cashier: sale?.cashierNameSnapshot || sale?.cashierName || sale?.seller || '', adminNote: sale?.adminNote || sale?.editNote || '',
})

export const buildSaleEditPatch = (sale, changes = {}) => {
  const subtotal = number(sale?.subtotal || number(sale?.total) + number(sale?.discount))
  const discount = Math.min(subtotal, Math.max(0, number(changes.discount)))
  const patch = { subtotal, discount, total: subtotal - discount, paymentMethod: changes.paymentMethod || sale.paymentMethod, orderType: changes.orderType || sale.orderType || sale.order?.orderType || null }
  const noteKey = ['customerNote', 'orderNote', 'cashierNote', 'note', 'notes'].find(key => sale?.[key] !== undefined) || 'customerNote'
  patch[noteKey] = String(changes.note ?? '')
  patch.cashierNameSnapshot = String(changes.cashier ?? sale?.cashierNameSnapshot ?? sale?.cashierName ?? sale?.seller ?? '')
  patch.adminNote = String(changes.adminNote ?? sale?.adminNote ?? sale?.editNote ?? '')
  return patch
}

export const saleEditPreservesIdentity = (before, after) => ['id', 'saleId', 'operationKey', 'orderNumber', 'operationalDayId', 'businessDate', 'items'].every(key => JSON.stringify(before?.[key] ?? null) === JSON.stringify(after?.[key] ?? null))
