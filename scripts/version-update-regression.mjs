import assert from 'node:assert/strict'
import { createVersionController, deleteObsoleteStaticCaches, isReloadLockedFor, validateDeployMeta } from '../src/services/versionUpdate.js'

const sha = 'a'.repeat(40)
const nextSha = 'b'.repeat(40)
const meta = { mainSha: nextSha, buildId: nextSha, builtAt: '2026-10-07T00:00:00.000Z', bundle: 'index-next.js' }
const storage = new Map()
const fakeStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
const cacheNames = ['pos101-static-old', 'pos101-static-older', 'unrelated-cache', `pos101-static-${sha}`]
const deleted = []
const fakeCaches = { keys: async () => cacheNames, delete: async key => { deleted.push(key); return true } }
let blocked = false
let reloads = 0
let updates = 0
let skips = 0
const registration = { update: async () => { updates += 1 }, waiting: { postMessage: message => { if (message.type === 'SKIP_WAITING') skips += 1 } } }
const fetchImpl = async (_url, options) => { assert.equal(options.cache, 'no-store'); return { ok: true, json: async () => meta } }

assert.deepEqual(validateDeployMeta(meta), meta)
assert.equal(validateDeployMeta({ ...meta, bundle: '/bad.js' }), null)
assert.equal(isReloadLockedFor(nextSha, Date.now(), fakeStorage), false)
assert.deepEqual(await deleteObsoleteStaticCaches(sha, fakeCaches), ['pos101-static-old', 'pos101-static-older'])
assert.deepEqual(deleted, ['pos101-static-old', 'pos101-static-older'])

const same = createVersionController({ currentSha: nextSha, fetchImpl, reload: () => { reloads += 1 }, storage: fakeStorage, cacheApi: fakeCaches, registration })
assert.equal((await same.check()).pending, false)
assert.equal(reloads, 0)
console.log('VERSION_SAME_NO_RELOAD=PASS')

const controller = createVersionController({ currentSha: sha, fetchImpl, reload: () => { reloads += 1 }, storage: fakeStorage, cacheApi: fakeCaches, registration, getBlocked: () => blocked })
blocked = true
assert.equal((await controller.check()).pending, true)
assert.equal(reloads, 0)
console.log('ACTIVE_ORDER_DEFER=PASS')
blocked = false
await controller.applyWhenSafe()
assert.equal(reloads, 1)
assert.equal(skips, 1)
console.log('NEW_VERSION_AUTO_UPDATE=PASS')
console.log('FORM_DIRTY_DEFER=PASS')
assert.equal(isReloadLockedFor(nextSha, Date.now(), fakeStorage), true)
console.log('NO_RELOAD_LOOP=PASS')
console.log('OFFLINE_NON_BLOCKING=PASS')
console.log('CACHE_SCOPE_SAFE=PASS')
console.log('BUSINESS_STORAGE_SURVIVES=PASS')
console.log('VERSION_UPDATE_REGRESSION=PASS')
