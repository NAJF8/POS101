const LIFECYCLE_KEY = '__POS101_PRE_CLOSE_LIFECYCLE__'

const safeText = value => String(value || '').slice(0, 160)

export const recordPreCloseLifecycle = ({ requestId, event, operationalDay } = {}) => {
  const payload = {
    requestId: Number(requestId) || 0,
    event: safeText(event),
    timestamp: new Date().toISOString(),
    businessDate: safeText(operationalDay?.businessDate),
    operationalDayId: safeText(operationalDay?.id || operationalDay?.operationalDayId),
  }
  if (typeof window !== 'undefined') {
    window[LIFECYCLE_KEY] = payload
    if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('pos101-pre-close-lifecycle', { detail: payload }))
  }
  if (typeof console !== 'undefined' && typeof console.info === 'function') console.info('POS101_PRE_CLOSE_LIFECYCLE', payload)
  return payload
}

export const readPreCloseLifecycle = () => {
  if (typeof window === 'undefined') return null
  return window[LIFECYCLE_KEY] || null
}
