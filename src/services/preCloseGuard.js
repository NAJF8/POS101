export const PRE_CLOSE_STATE = Object.freeze({
  UNKNOWN: 'unknown',
  CHECKING: 'checking',
  ALLOWED: 'allowed',
  BLOCKED: 'blocked',
  ERROR: 'error',
})

export const beginPreCloseCheck = previous => ({
  ...previous,
  loading: true,
  state: PRE_CLOSE_STATE.CHECKING,
  allowed: false,
  message: '',
  error: null,
})

export const completePreCloseCheck = result => ({
  ...result,
  loading: false,
  state: result?.allowed ? PRE_CLOSE_STATE.ALLOWED : PRE_CLOSE_STATE.BLOCKED,
  allowed: Boolean(result?.allowed),
  reason: result?.reason || (result?.allowed ? '' : 'UNKNOWN'),
  message: result?.allowed ? (result?.message || '') : (result?.message || 'تعذر التحقق من حالة الإغلاق.'),
  error: null,
})

export const failPreCloseCheck = error => ({
  loading: false,
  state: PRE_CLOSE_STATE.ERROR,
  allowed: false,
  reason: error?.code || 'RECONCILIATION_ERROR',
  message: error?.message || 'تعذر التحقق من مزامنة المبيعات.',
  error: {
    name: error?.name || 'Error',
    code: error?.code || '',
    message: error?.message || String(error || ''),
  },
})

export const isCurrentPreCloseRequest = (requestId, currentRequestId) => requestId === currentRequestId

export const isLatestPreCloseRequest = (requestId, currentRequestId, latestResolvedId = 0) => {
  return requestId === currentRequestId && requestId >= latestResolvedId
}

export const withPreCloseTimeout = (promise, timeoutMs = 15000, message = 'انتهت مهلة فحص ما قبل الإغلاق.') => {
  const delay = Number(timeoutMs)
  if (!Number.isFinite(delay) || delay <= 0) return Promise.resolve(promise)
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'PRE_CLOSE_TIMEOUT' })), delay)
      Promise.resolve(promise).finally(() => clearTimeout(timer)).catch(() => {})
    }),
  ])
}
