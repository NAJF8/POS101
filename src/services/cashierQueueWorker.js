export const createCashierQueueWorker = ({ processQueue, hasEligibleQueue = () => true, intervalMs = 30000 } = {}) => {
  if (typeof processQueue !== 'function') throw new TypeError('processQueue is required')
  let running = null
  let timer = null
  let stopped = false

  const run = () => {
    if (stopped || !hasEligibleQueue()) return Promise.resolve(null)
    if (running) return running
    running = Promise.resolve()
      .then(processQueue)
      .finally(() => { running = null })
    return running
  }

  const start = ({ events = [], target = globalThis } = {}) => {
    stopped = false
    const trigger = () => { void run().catch(() => {}) }
    for (const event of events) target.addEventListener?.(event, trigger)
    if (intervalMs > 0) timer = target.setInterval?.(trigger, intervalMs)
    trigger()
    return () => {
      stopped = true
      for (const event of events) target.removeEventListener?.(event, trigger)
      if (timer) target.clearInterval?.(timer)
      timer = null
    }
  }

  return { run, start, isRunning: () => Boolean(running) }
}
