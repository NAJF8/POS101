export const createCashierQueueWorker = ({ processQueue, hasEligibleQueue = () => true, intervalMs = 30000, onDiagnostic = null } = {}) => {
  if (typeof processQueue !== 'function') throw new TypeError('processQueue is required')
  let running = null
  let timer = null
  let stopped = false

  const diagnostic = (event, detail = {}) => {
    const payload = { event, at: Date.now(), ...detail }
    try { onDiagnostic?.(payload) } catch {}
    if (typeof console !== 'undefined') console.info('[POS_CASHIER_QUEUE_WORKER]', payload)
    return payload
  }

  const run = (trigger = 'manual') => {
    if (stopped) { diagnostic('WORKER_RUN_SKIPPED', { trigger, reason: 'stopped' }); return Promise.resolve(null) }
    if (running) { diagnostic('WORKER_RUN_SKIPPED', { trigger, reason: 'locked' }); return running }
    if (!hasEligibleQueue()) { diagnostic('WORKER_RUN_SKIPPED', { trigger, reason: 'ineligible' }); return Promise.resolve(null) }
    diagnostic('WORKER_PROCESS_START', { trigger })
    running = Promise.resolve()
      .then(processQueue)
      .then(result => { diagnostic('WORKER_PROCESS_COMPLETE', { trigger, result: result && typeof result === 'object' ? { uploaded: result.uploaded, updated: result.updated, centralCount: result.centralCount } : null }); return result })
      .catch(error => { diagnostic('WORKER_PROCESS_ERROR', { trigger, code: error?.code || 'UNKNOWN', message: error?.message || String(error) }); throw error })
      .finally(() => { running = null; diagnostic('WORKER_LOCK_RELEASED', { trigger }) })
    return running
  }

  const start = ({ events = [], target = globalThis } = {}) => {
    stopped = false
    const trigger = event => { void run(event).catch(() => {}) }
    const handlers = new Map(events.map(event => [event, () => trigger(event)]))
    for (const [event, handler] of handlers) target.addEventListener?.(event, handler)
    if (intervalMs > 0) timer = target.setInterval?.(() => trigger('interval'), intervalMs)
    diagnostic('WORKER_STARTED', { intervalMs, events })
    trigger('startup')
    return () => {
      stopped = true
      for (const [event, handler] of handlers) target.removeEventListener?.(event, handler)
      if (timer) target.clearInterval?.(timer)
      timer = null
    }
  }

  return { run, start, isRunning: () => Boolean(running) }
}
