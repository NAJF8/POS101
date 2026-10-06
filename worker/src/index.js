const KIOSKS_PATH = 'pos101_kiosks'
const CODES_PATH = 'pos101_kiosk_activation_codes'
const CHALLENGES_PATH = 'pos101_kiosk_challenges'
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const CODE_MAX_LENGTH = 128
const DEFAULT_ALLOWED_ORIGINS = ['https://najf8.github.io', 'http://localhost:5174', 'http://127.0.0.1:5174']
const allowedOrigins = env => new Set((env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(',')).split(',').map(origin => origin.trim()).filter(Boolean))

const json = (body, status = 200, origin = '', extra = {}) => {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'vary': 'Origin', ...extra }
  if (origin) headers['access-control-allow-origin'] = origin
  return status === 204 ? new Response(null, { status, headers }) : new Response(JSON.stringify(body), { status, headers })
}
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error }
const text = value => typeof value === 'string' ? value.trim() : ''
const safeId = value => /^[A-Za-z0-9_-]{1,128}$/.test(value)
const base64Url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const fromBase64Url = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0))
const utf8 = value => new TextEncoder().encode(value)
const decodePem = pem => fromBase64Url(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '').replaceAll('+', '-').replaceAll('/', '_'))

const stablePublicKey = key => ({ kty: key.kty, crv: key.crv, x: key.x, y: key.y })
const normalizePublicKey = key => {
  if (!key || key.kty !== 'EC' || key.crv !== 'P-256' || typeof key.x !== 'string' || typeof key.y !== 'string') fail(400, 'Invalid kiosk public key.')
  return stablePublicKey(key)
}
const sha256Hex = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(value))), byte => byte.toString(16).padStart(2, '0')).join('')
const publicKeyFingerprint = key => sha256Hex(JSON.stringify(stablePublicKey(key)))
const verifySignature = async (publicKeyJwk, challenge, signature) => {
  try {
    const key = await crypto.subtle.importKey('jwk', publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromBase64Url(signature), utf8(challenge))
  } catch { return false }
}

const rtdbUrl = env => env.FIREBASE_DATABASE_URL || 'https://cmms-37512-default-rtdb.asia-southeast1.firebasedatabase.app'
const firebaseAccessToken = async (env, fetchImpl, clock) => {
  if (env.__TEST_ACCESS_TOKEN) return env.__TEST_ACCESS_TOKEN
  const now = Math.floor(clock() / 1000)
  if (env.__accessToken && env.__accessTokenExpiresAt > now + 30) return env.__accessToken
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) fail(500, 'Firebase Worker secrets are not configured.')
  const header = base64Url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64Url(utf8(JSON.stringify({ iss: env.FIREBASE_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })))
  const key = await crypto.subtle.importKey('pkcs8', decodePem(env.FIREBASE_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = base64Url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(`${header}.${payload}`)))
  const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${payload}.${signature}` }) })
  if (!response.ok) fail(502, 'Firebase service authentication failed.')
  const token = await response.json()
  env.__accessToken = token.access_token
  env.__accessTokenExpiresAt = now + Number(token.expires_in || 3600)
  return env.__accessToken
}

const createFirebaseStore = (env, fetchImpl, clock) => {
  const request = async (path, options = {}) => {
    const token = await firebaseAccessToken(env, fetchImpl, clock)
    const response = await fetchImpl(`${rtdbUrl(env)}/${path}.json`, { ...options, headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) } })
    if (!response.ok && !(response.status === 412 && options.allowPrecondition)) fail(502, 'Firebase database request failed.')
    return response
  }
  return {
    async get(path, withEtag = false) {
      const response = await request(path, { headers: withEtag ? { 'x-firebase-etag': 'true' } : {} })
      return { value: await response.json(), etag: response.headers.get('etag') }
    },
    async set(path, value) { await request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }) },
    async update(path, value) { await request(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }) },
    async consume(path, predicate, updateValue) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await this.get(path, true)
        if (!predicate(current.value)) return false
        const response = await request(path, { method: 'PUT', allowPrecondition: true, headers: { 'content-type': 'application/json', 'if-match': current.etag || 'null' }, body: JSON.stringify(updateValue(current.value)) })
        if (response.status !== 412) return response.ok
      }
      return false
    },
  }
}

const createTokenIssuer = (env, fetchImpl, clock) => async kioskId => {
  if (env.__TEST_TOKEN_ISSUER) return env.__TEST_TOKEN_ISSUER(kioskId)
  const now = Math.floor(clock() / 1000)
  const uid = `kiosk:${kioskId}`
  if (typeof uid !== 'string' || uid.length < 1 || uid.length > 128) fail(500, 'Kiosk token UID is invalid.')
  const header = base64Url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64Url(utf8(JSON.stringify({ iss: env.FIREBASE_CLIENT_EMAIL, sub: env.FIREBASE_CLIENT_EMAIL, aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', iat: now, exp: now + 3600, uid, claims: { pos101_kiosk: true, kioskId, scope: 'cashier' } })))
  const key = await crypto.subtle.importKey('pkcs8', decodePem(env.FIREBASE_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = base64Url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(`${header}.${payload}`)))
  return `${header}.${payload}.${signature}`
}

const createRateLimiter = (env, clock) => {
  const memory = new Map()
  return async (request, key, limit = 12, windowMs = 60_000) => {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown'
    const storageKey = `kiosk:${key}:${ip}`
    if (env.KIOSK_RATE_LIMIT) {
      const current = JSON.parse(await env.KIOSK_RATE_LIMIT.get(storageKey) || 'null') || { count: 0, expiresAt: 0 }
      if (current.expiresAt <= clock()) current.count = 0
      current.count += 1
      current.expiresAt = current.expiresAt > clock() ? current.expiresAt : clock() + windowMs
      await env.KIOSK_RATE_LIMIT.put(storageKey, JSON.stringify(current), { expirationTtl: Math.ceil(windowMs / 1000) })
      return current.count <= limit
    }
    if (env.ENVIRONMENT === 'production') return false
    const current = memory.get(storageKey) || { count: 0, expiresAt: 0 }
    if (current.expiresAt <= clock()) current.count = 0
    current.count += 1
    current.expiresAt = current.expiresAt > clock() ? current.expiresAt : clock() + windowMs
    memory.set(storageKey, current)
    return current.count <= limit
  }
}

const findActivationCode = async (store, code, clock) => {
  if (!code || code.length > CODE_MAX_LENGTH) return null
  const records = (await store.get(CODES_PATH)).value || {}
  for (const [id, record] of Object.entries(records)) {
    if (!record || record.used === true || record.usedAt || Number(record.expiresAt || 0) <= clock()) continue
    if ((await sha256Hex(`${record.salt}:${code}`)) === record.codeHash) return { id, ...record }
  }
  return null
}

const createHandler = ({ fetchImpl = fetch, clock = () => Date.now(), random = () => crypto.randomUUID() } = {}) => async (request, env, ctx) => {
  const origin = request.headers.get('origin') || ''
  const originAllowlist = allowedOrigins(env)
  if (!originAllowlist.has(origin)) return json({ error: 'origin_denied' }, 403)
  if (request.method === 'OPTIONS') return json({}, 204, origin)
  const url = new URL(request.url)
  if (!['/kiosk/challenge', '/kiosk/activate', '/kiosk/renew'].includes(url.pathname) || request.method !== 'POST') return json({ error: 'not_found' }, 404, origin)
  const limiter = createRateLimiter(env, clock)
  if (!await limiter(request, url.pathname.slice('/kiosk/'.length), url.pathname === '/kiosk/challenge' ? 15 : 10)) return json({ error: 'rate_limited' }, 429, origin, { 'retry-after': '60' })
  try {
    const body = await request.json()
    const store = env.__TEST_STORE || createFirebaseStore(env, fetchImpl, clock)
    const issueToken = createTokenIssuer(env, fetchImpl, clock)
    if (url.pathname === '/kiosk/challenge') {
      const publicKeyJwk = normalizePublicKey(body.publicKeyJwk)
      const mode = body.mode === 'renew' ? 'renew' : 'activate'
      let kioskId = ''
      let activationCodeId = ''
      if (mode === 'activate') {
        const record = await findActivationCode(store, text(body.activationCode), clock)
        if (!record) fail(403, 'Activation code is invalid or expired.')
        activationCodeId = record.id
      } else {
        kioskId = text(body.kioskId)
        if (!safeId(kioskId)) fail(400, 'Kiosk ID is invalid.')
        const kiosk = (await store.get(`${KIOSKS_PATH}/${kioskId}`)).value
        if (!kiosk || kiosk.active !== true || (await publicKeyFingerprint(publicKeyJwk)) !== kiosk.publicKeyFingerprint) fail(403, 'Kiosk is revoked or device key does not match.')
      }
      const challengeId = random()
      const challenge = base64Url(crypto.getRandomValues(new Uint8Array(32)))
      await store.set(`${CHALLENGES_PATH}/${challengeId}`, { id: challengeId, mode, kioskId, activationCodeId, challenge, publicKeyJwk, createdAt: clock(), expiresAt: clock() + CHALLENGE_TTL_MS, usedAt: null })
      return json({ challengeId, challenge, kioskId }, 200, origin)
    }
    const challengeId = text(body.challengeId)
    const signature = text(body.signature)
    const publicKeyJwk = normalizePublicKey(body.publicKeyJwk)
    const challengePath = `${CHALLENGES_PATH}/${challengeId}`
    const challenge = (await store.get(challengePath)).value
    if (!challenge || challenge.usedAt || Number(challenge.expiresAt || 0) <= clock()) fail(403, 'Challenge is invalid or expired.')
    if ((await publicKeyFingerprint(publicKeyJwk)) !== (await publicKeyFingerprint(challenge.publicKeyJwk)) || !await verifySignature(publicKeyJwk, challenge.challenge, signature)) fail(403, 'Device signature is invalid.')
    const consumed = await store.consume(challengePath, current => current && !current.usedAt && Number(current.expiresAt || 0) > clock(), current => ({ ...current, usedAt: clock() }))
    if (!consumed) fail(409, 'Challenge was already consumed.')
    let kioskId = challenge.kioskId
    if (url.pathname === '/kiosk/activate') {
      if (challenge.mode !== 'activate') fail(400, 'Activation challenge required.')
      const codePath = `${CODES_PATH}/${challenge.activationCodeId}`
      const codeConsumed = await store.consume(codePath, current => current && current.used !== true && !current.usedAt && Number(current.expiresAt || 0) > clock(), current => ({ ...current, used: true, usedAt: clock(), usedAtBy: 'kiosk-activation' }))
      if (!codeConsumed) fail(403, 'Activation code is invalid or already used.')
      kioskId = `kiosk-${random().replaceAll('-', '').slice(0, 24)}`
      const publicKeyFingerprintValue = await publicKeyFingerprint(publicKeyJwk)
      await store.set(`${KIOSKS_PATH}/${kioskId}`, { kioskId, active: true, scope: 'cashier', name: '101 COFFEE Main Cashier', devicePublicKey: publicKeyJwk, publicKeyFingerprint: publicKeyFingerprintValue, createdAt: clock(), activatedAt: clock(), lastSeenAt: clock(), revokedAt: null })
    } else {
      if (challenge.mode !== 'renew') fail(400, 'Renew challenge required.')
      const kiosk = (await store.get(`${KIOSKS_PATH}/${kioskId}`)).value
      if (!kiosk || kiosk.active !== true || (await publicKeyFingerprint(publicKeyJwk)) !== kiosk.publicKeyFingerprint) fail(403, 'Kiosk is revoked or device key does not match.')
      await store.update(`${KIOSKS_PATH}/${kioskId}`, { lastSeenAt: clock() })
    }
    return json({ token: await issueToken(kioskId), kioskId, scope: 'cashier' }, 200, origin)
  } catch (error) {
    return json({ error: error.message || 'request_failed' }, error.status || 500, origin)
  }
}

export default { fetch: createHandler() }
export const __test = { createHandler, sha256Hex, publicKeyFingerprint, normalizePublicKey }
