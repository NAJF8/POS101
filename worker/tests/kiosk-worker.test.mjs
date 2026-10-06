import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { test } from 'node:test'
import { __test } from '../src/index.js'

const origin = 'http://localhost:5174'
const makeStore = () => {
  const values = new Map()
  const get = path => {
    if (values.has(path)) return values.get(path)
    const prefix = `${path}/`
    const children = Object.entries(Object.fromEntries(values)).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value])
    if (!children.length) return null
    return Object.fromEntries(children)
  }
  return {
    get: async path => ({ value: get(path), etag: `etag-${path}` }),
    set: async (path, value) => values.set(path, value),
    update: async (path, value) => values.set(path, { ...(get(path) || {}), ...value }),
    consume: async (path, predicate, update) => { const current = get(path); if (!predicate(current)) return false; values.set(path, update(current)); return true },
    values,
  }
}
const request = (path, body) => new Request(`https://worker.test${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('kiosk activation, replay, renewal and revocation', async () => {
  const store = makeStore()
  const limiter = { get: async () => null, put: async () => {} }
  let now = Date.now()
  const tokenFor = kioskId => `header.${Buffer.from(JSON.stringify({ iss: 'test-service-account@cmms-37512.iam.gserviceaccount.com', sub: 'test-service-account@cmms-37512.iam.gserviceaccount.com', aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', iat: 1_700_000_000, exp: 1_700_003_600, uid: `kiosk:${kioskId}`, claims: { pos101_kiosk: true, kioskId, scope: 'cashier' } })).toString('base64url')}.signature`
  const env = { ENVIRONMENT: 'test', ALLOWED_ORIGINS: 'https://najf8.github.io,http://localhost:5174,http://127.0.0.1:5174', KIOSK_RATE_LIMIT: limiter, __TEST_STORE: store, __TEST_TOKEN_ISSUER: tokenFor }
  const handler = __test.createHandler({ clock: () => now, random: () => 'activation-device-123456789' })
  const preflight = await handler(new Request('https://worker.test/kiosk/challenge', { method: 'OPTIONS', headers: { origin } }), env)
  assert.equal(preflight.status, 204)
  const code = 'POS101-TEST-CODE'
  const salt = 'salt'
  const codeHash = await __test.sha256Hex(`${salt}:${code}`)
  await store.set('pos101_kiosk_activation_codes/code-1', { codeHash, salt, used: false, usedAt: null, expiresAt: Date.now() + 60_000, createdAt: Date.now(), label: 'test' })
  const keys = await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicKeyJwk = await crypto.webcrypto.subtle.exportKey('jwk', keys.publicKey)
  const challengeResponse = await handler(request('/kiosk/challenge', { mode: 'activate', activationCode: code, publicKeyJwk }), env)
  assert.equal(challengeResponse.status, 200)
  const challenge = await challengeResponse.json()
  const raw = await crypto.webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(challenge.challenge))
  const signature = Buffer.from(raw).toString('base64url')
  const wrongSignatureResponse = await handler(request('/kiosk/activate', { challengeId: challenge.challengeId, signature: 'wrong-signature', publicKeyJwk }), env)
  assert.equal(wrongSignatureResponse.status, 403)
  const activatedResponse = await handler(request('/kiosk/activate', { challengeId: challenge.challengeId, signature, publicKeyJwk }), env)
  assert.equal(activatedResponse.status, 200)
  const activated = await activatedResponse.json()
  const tokenPayload = JSON.parse(Buffer.from(activated.token.split('.')[1], 'base64url').toString())
  assert.equal(typeof tokenPayload.uid, 'string')
  assert.ok(tokenPayload.uid.length >= 1)
  assert.ok(tokenPayload.uid.length <= 128)
  assert.equal(tokenPayload.sub, 'test-service-account@cmms-37512.iam.gserviceaccount.com')
  assert.equal(tokenPayload.claims.scope, 'cashier')
  assert.equal(tokenPayload.claims.pos101_kiosk, true)
  assert.equal(tokenPayload.claims.kioskId, activated.kioskId)
  assert.equal(Object.prototype.hasOwnProperty.call(tokenPayload, 'kioskId'), false)
  const kiosk = (await store.get(`pos101_kiosks/${activated.kioskId}`)).value
  assert.equal(kiosk.active, true)
  assert.equal(kiosk.scope, 'cashier')
  assert.equal((await store.get('pos101_kiosk_activation_codes/code-1')).value.used, true)

  const replayResponse = await handler(request('/kiosk/activate', { challengeId: challenge.challengeId, signature, publicKeyJwk }), env)
  assert.equal(replayResponse.status, 403)
  const reusedCodeChallenge = await handler(request('/kiosk/challenge', { mode: 'activate', activationCode: code, publicKeyJwk }), env)
  assert.equal(reusedCodeChallenge.status, 403)
  const wrongCodeChallenge = await handler(request('/kiosk/challenge', { mode: 'activate', activationCode: 'wrong-code', publicKeyJwk }), env)
  assert.equal(wrongCodeChallenge.status, 403)
  const renewChallengeResponse = await handler(request('/kiosk/challenge', { mode: 'renew', kioskId: activated.kioskId, publicKeyJwk }), env)
  assert.equal(renewChallengeResponse.status, 200)
  const renewChallenge = await renewChallengeResponse.json()
  const renewRaw = await crypto.webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(renewChallenge.challenge))
  const renewed = await handler(request('/kiosk/renew', { challengeId: renewChallenge.challengeId, signature: Buffer.from(renewRaw).toString('base64url'), publicKeyJwk }), env)
  assert.equal(renewed.status, 200)
  const expiryCode = 'POS101-EXPIRED'
  await store.set('pos101_kiosk_activation_codes/expired', { codeHash: await __test.sha256Hex(`salt:${expiryCode}`), salt: 'salt', used: false, usedAt: null, expiresAt: now - 1, createdAt: now, label: 'expired' })
  const expired = await handler(request('/kiosk/challenge', { mode: 'activate', activationCode: expiryCode, publicKeyJwk }), env)
  assert.equal(expired.status, 403)
  const expiringChallengeResponse = await handler(request('/kiosk/challenge', { mode: 'renew', kioskId: activated.kioskId, publicKeyJwk }), env)
  assert.equal(expiringChallengeResponse.status, 200)
  const expiringChallenge = await expiringChallengeResponse.json()
  now += 5 * 60 * 1000 + 1
  const expiredChallengeResponse = await handler(request('/kiosk/renew', { challengeId: expiringChallenge.challengeId, signature: 'expired', publicKeyJwk }), env)
  assert.equal(expiredChallengeResponse.status, 403)
  await store.update(`pos101_kiosks/${activated.kioskId}`, { active: false, revokedAt: Date.now() })
  const revoked = await handler(request('/kiosk/challenge', { mode: 'renew', kioskId: activated.kioskId, publicKeyJwk }), env)
  assert.equal(revoked.status, 403)
  console.log('WORKER_CHALLENGE=PASS')
  console.log('DEVICE_SIGNATURE=PASS')
  console.log('WRONG_SIGNATURE=DENIED')
  console.log('EXPIRED_CHALLENGE=DENIED')
  console.log('REPLAYED_CHALLENGE=DENIED')
  console.log('ACTIVATION_VALID=PASS')
  console.log('ACTIVATION_WRONG_CODE=DENIED')
  console.log('ACTIVATION_EXPIRED=DENIED')
  console.log('ACTIVATION_REUSE=DENIED')
  console.log('CUSTOM_TOKEN=PASS')
  console.log('CUSTOM_TOKEN_UID_PRESENT=PASS')
  console.log('CUSTOM_TOKEN_UID_LENGTH=PASS')
  console.log('CUSTOM_TOKEN_CLAIMS_NESTED=PASS')
  console.log('ACTIVE_KIOSK=PASS')
  console.log('REVOKED_KIOSK=DENIED')
})
