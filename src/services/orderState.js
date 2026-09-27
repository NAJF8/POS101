export const hasOrderItems = order => Array.isArray(order?.items) && order.items.some(item => Number(item?.quantity || 0) > 0)

export const isClosedOrder = order => Boolean(
  order?.completed || order?.voided || order?.cancelled || order?.closed ||
  ['completed', 'voided', 'cancelled', 'closed'].includes(String(order?.status || '').toLowerCase())
)

export const isOpenOrder = order => hasOrderItems(order) && !isClosedOrder(order)

export const getOpenOrders = orders => (Array.isArray(orders) ? orders : []).filter(isOpenOrder)
