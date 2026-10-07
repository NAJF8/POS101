export const BUILD_SHA = String(import.meta.env?.VITE_BUILD_SHA || 'development')
export const VERSION_MANIFEST_PATH = `${import.meta.env?.BASE_URL || '/'}deploy-meta.json`
export const UPDATE_RELOAD_LOCK = 'pos101.updateReload'
export const STATIC_CACHE_PREFIX = 'pos101-static-'
export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000

const isBrowser = () => typeof window !== 'undefined'

export const validateDeployMeta = value => {
  if (!value || typeof value !== 'object') return null
  const fields = ['mainSha', 'buildId', 'builtAt', 'bundle']
  if (fields.some(field => typeof value[field] !== 'string' || !value[field].trim())) return null
  if (!/^[^/\\]+$/.test(value.bundle) || !value.bundle.endsWith('.js')) return null
  return { mainSha: value.mainSha.trim(), buildId: value.buildId.trim(), builtAt: value.builtAt.trim(), bundle: value.bundle.trim() }
}

export const readReloadLock = (storage = isBrowser() ? window.sessionStorage : null) => {
  try { return JSON.parse(storage?.getItem(UPDATE_RELOAD_LOCK) || 'null') } catch { return null }
}

export const isReloadLockedFor = (targetSha, now = Date.now(), storage = isBrowser() ? window.sessionStorage : null) => {
  const lock = readReloadLock(storage)
  return Boolean(lock?.targetSha === targetSha && Number.isFinite(lock.timestamp) && now - lock.timestamp < 10 * 60 * 1000)
}

export const writeReloadLock = (targetSha, storage = isBrowser() ? window.sessionStorage : null, now = Date.now()) => {
  try { storage?.setItem(UPDATE_RELOAD_LOCK, JSON.stringify({ targetSha, timestamp: now })) } catch { /* sessionStorage can be unavailable in privacy mode */ }
}

export const clearReloadLock = (storage = isBrowser() ? window.sessionStorage : null) => {
  try { storage?.removeItem(UPDATE_RELOAD_LOCK) } catch { /* non-blocking */ }
}

export const isNewerBuild = (remote, currentSha = BUILD_SHA) => Boolean(remote?.mainSha && currentSha && remote.mainSha !== currentSha)

export const deleteObsoleteStaticCaches = async (currentSha = BUILD_SHA, cacheApi = isBrowser() ? window.caches : null) => {
  if (!cacheApi?.keys || !cacheApi.delete) return []
  const names = await cacheApi.keys()
  const obsolete = names.filter(name => name.startsWith(STATIC_CACHE_PREFIX) && name !== `${STATIC_CACHE_PREFIX}${currentSha}`)
  await Promise.all(obsolete.map(name => cacheApi.delete(name)))
  return obsolete
}

export const createVersionController = ({
  currentSha = BUILD_SHA,
  fetchImpl = isBrowser() ? window.fetch.bind(window) : null,
  registration = null,
  reload = isBrowser() ? () => window.location.reload() : () => {},
  setStatus = () => {},
  getBlocked = () => false,
  cacheApi = isBrowser() ? window.caches : null,
  storage = isBrowser() ? window.sessionStorage : null,
  now = () => Date.now(),
  manifestPath = VERSION_MANIFEST_PATH,
} = {}) => {
  let remoteMeta = null
  let pending = false
  let reloading = false

  const clearIfCurrent = () => {
    if (remoteMeta?.mainSha === currentSha) { pending = false; clearReloadLock(storage) }
  }

  const fetchRemote = async () => {
    if (!fetchImpl) return null
    const controller = typeof AbortController === 'undefined' ? null : new AbortController()
    const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null
    try {
      const separator = manifestPath.includes('?') ? '&' : '?'
      const response = await fetchImpl(`${manifestPath}${separator}v=${encodeURIComponent(currentSha)}-${now()}`, { cache: 'no-store', signal: controller?.signal })
      if (!response.ok) return null
      return validateDeployMeta(await response.json())
    } catch { return null } finally { if (timeout) clearTimeout(timeout) }
  }

  const applyWhenSafe = async () => {
    if (!pending || reloading || !remoteMeta || getBlocked()) return false
    if (isReloadLockedFor(remoteMeta.mainSha, now(), storage)) return false
    reloading = true
    writeReloadLock(remoteMeta.mainSha, storage, now())
    setStatus('updating')
    try {
      await deleteObsoleteStaticCaches(currentSha, cacheApi)
      const swRegistration = registration || (isBrowser() && navigator.serviceWorker?.getRegistration ? await navigator.serviceWorker.getRegistration() : null)
      const swContainer = isBrowser() ? navigator.serviceWorker : null
      const waitForControllerChange = () => new Promise(resolve => {
        if (!swContainer?.addEventListener) return resolve()
        let done = false
        const finish = () => { if (done) return; done = true; swContainer.removeEventListener('controllerchange', finish); resolve() }
        swContainer.addEventListener('controllerchange', finish)
        setTimeout(finish, 4000)
      })
      if (swRegistration?.waiting) {
        const changed = waitForControllerChange()
        swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' })
        await changed
      } else if (swRegistration?.update) {
        await swRegistration.update()
        if (swRegistration.waiting) {
          const changed = waitForControllerChange()
          swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' })
          await changed
        }
      }
      reload()
      return true
    } catch {
      reloading = false
      setStatus('pending')
      return false
    }
  }

  const check = async () => {
    const next = await fetchRemote()
    if (!next) return { ok: false, remote: null, pending }
    remoteMeta = next
    if (isNewerBuild(next, currentSha)) {
      pending = true
      setStatus(getBlocked() ? 'deferred' : 'pending')
      await applyWhenSafe()
    } else clearIfCurrent()
    return { ok: true, remote: next, pending }
  }

  return { check, applyWhenSafe, getRemote: () => remoteMeta, isPending: () => pending }
}

export const installServiceWorker = async (baseUrl = import.meta.env?.BASE_URL || '/') => {
  if (!isBrowser() || !('serviceWorker' in navigator)) return null
  try { return await navigator.serviceWorker.register(`${baseUrl}sw.js`, { scope: baseUrl }) } catch { return null }
}
