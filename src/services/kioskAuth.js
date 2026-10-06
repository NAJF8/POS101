const DB_NAME = 'pos101-kiosk-auth'
const STORE_NAME = 'device'
const RECORD_KEY = 'primary'

const openStore = () => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') return reject(new Error('هذا المتصفح لا يدعم تخزين مفتاح جهاز POS.'))
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('تعذر فتح تخزين جهاز POS.'))
})

const readRecord = async () => {
  const db = await openStore()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_KEY)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error || new Error('تعذر قراءة مفتاح جهاز POS.'))
  })
}

const saveRecord = async record => {
  const db = await openStore()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record, RECORD_KEY)
    request.onsuccess = () => resolve(record)
    request.onerror = () => reject(request.error || new Error('تعذر حفظ مفتاح جهاز POS.'))
  })
}

export const getKioskDeviceRecord = readRecord

export const getOrCreateKioskDeviceRecord = async () => {
  const current = await readRecord()
  if (current?.deviceId && current?.publicKeyJwk && current?.privateKey) return current
  const generatedKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', generatedKeyPair.publicKey)
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', generatedKeyPair.privateKey)
  const privateKey = await crypto.subtle.importKey('jwk', privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  return saveRecord({
    deviceId: current?.deviceId || `pos101-device-${crypto.randomUUID()}`,
    publicKeyJwk,
    privateKey,
    kioskId: current?.kioskId || '',
    activatedAt: current?.activatedAt || null,
  })
}

export const saveKioskIdentity = async ({ kioskId, activatedAt = Date.now() }) => {
  const record = await readRecord()
  if (!record?.privateKey || !record?.publicKeyJwk) throw new Error('مفتاح جهاز POS غير موجود.')
  return saveRecord({ ...record, kioskId, activatedAt })
}

export const signKioskChallenge = async challenge => {
  const record = await readRecord()
  if (!record?.privateKey) throw new Error('مفتاح جهاز POS غير موجود.')
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    record.privateKey,
    new TextEncoder().encode(String(challenge)),
  )
  return new Uint8Array(signature)
}

export const signatureToBase64Url = signature => {
  const bytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
