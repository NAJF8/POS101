const escapeAttribute = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

const stylesheetMarkup = () => [...document.querySelectorAll('link[rel="stylesheet"]')]
  .map(link => `<link rel="stylesheet" href="${escapeAttribute(link.href)}">`)
  .join('')

// Print only the rendered receipt. The iframe has no app URL, title, header,
// or footer content of its own, and the browser prints the receipt document
// rather than the dashboard that opened it.
export const printReceiptDocument = async receiptElement => {
  if (!receiptElement) return false
  const frame = document.createElement('iframe')
  frame.title = 'print'
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.width = '1px'
  frame.style.height = '1px'
  frame.style.right = '-2px'
  frame.style.bottom = '-2px'
  frame.style.border = '0'
  frame.style.opacity = '0'
  frame.srcdoc = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title></title>${stylesheetMarkup()}</head><body>${receiptElement.outerHTML}</body></html>`
  document.body.appendChild(frame)

  const printWindow = frame.contentWindow
  const printDocument = frame.contentDocument
  if (!printWindow || !printDocument) {
    frame.remove()
    return false
  }

  await new Promise(resolve => {
    if (printDocument.readyState === 'complete') resolve()
    else frame.addEventListener('load', resolve, { once: true })
  })
  await (printDocument.fonts?.ready || Promise.resolve())
  await Promise.all([...printDocument.images].map(image => {
    if (image.complete) return image.decode ? image.decode().catch(() => {}) : Promise.resolve()
    return new Promise(resolve => {
      image.addEventListener('load', resolve, { once: true })
      image.addEventListener('error', resolve, { once: true })
    })
  }))
  await new Promise(resolve => printWindow.requestAnimationFrame(() => printWindow.requestAnimationFrame(resolve)))

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    frame.remove()
  }
  printWindow.addEventListener('afterprint', cleanup, { once: true })
  printWindow.focus()
  printWindow.print()
  window.setTimeout(cleanup, 1500)
  return true
}
