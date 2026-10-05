/*
  Read-only browser snapshot for the cashier device.
  Run on https://najf8.github.io/POS101/ in DevTools Console. It never clears
  storage and only downloads a JSON copy of browser-visible storage metadata.
*/
(() => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const copyStorage = storage => Object.fromEntries(Object.keys(storage).map(key => [key, storage.getItem(key)]))
  const payload = {
    capturedAt: new Date().toISOString(),
    origin: location.origin,
    href: location.href,
    localStorage: copyStorage(localStorage),
    sessionStorage: copyStorage(sessionStorage),
    indexedDBDatabases: typeof indexedDB.databases === 'function' ? indexedDB.databases().then(rows => rows.map(row => ({ name: row.name || '', version: row.version || 0 }))) : Promise.resolve([]),
  }
  payload.indexedDBDatabases.then(indexedDBDatabases => {
    const blob = new Blob([JSON.stringify({ ...payload, indexedDBDatabases }, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `RECOVERY-SNAPSHOT-POS101-${timestamp}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    console.log('Downloaded read-only POS101 recovery snapshot:', link.download)
  })
})()
