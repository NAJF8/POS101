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
  message: result?.allowed ? '' : (result?.message || 'تعذر التحقق من حالة الإغلاق.'),
  error: null,
})

export const failPreCloseCheck = error => ({
  loading: false,
  state: PRE_CLOSE_STATE.ERROR,
  allowed: false,
  message: error?.message || 'تعذر التحقق من مزامنة المبيعات.',
  error: {
    name: error?.name || 'Error',
    code: error?.code || '',
    message: error?.message || String(error || ''),
  },
})

export const isCurrentPreCloseRequest = (requestId, currentRequestId) => requestId === currentRequestId
