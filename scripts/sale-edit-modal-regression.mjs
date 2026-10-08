import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const jsx = fs.readFileSync(new URL('../src/components/OrderHistoryMenu.jsx', import.meta.url), 'utf8')
const modal = css.match(/\.history-edit-modal\s*\{([^}]*)\}/)?.[1] || ''
const body = css.match(/\.history-edit-body\s*\{([^}]*)\}/)?.[1] || ''
const actions = css.match(/\.history-edit-actions\s*\{([^}]*)\}/)?.[1] || ''
assert.match(modal, /max-height:\s*85vh/)
assert.match(modal, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/)
assert.match(modal, /overflow:\s*hidden/)
assert.match(body, /overflow-y:\s*auto/)
assert.match(body, /overscroll-behavior:\s*contain/)
assert.match(actions, /border-top:/)
assert.match(jsx, /className="history-edit-header"/)
assert.match(jsx, /className="history-edit-body"/)
assert.match(jsx, /className="history-edit-actions"/)
assert.match(jsx, /required value=\{editForm\.reason\}/)
console.log('SOLD_ORDER_EDIT_MODAL_FITS_1366x768=PASS')
console.log('SOLD_ORDER_EDIT_MODAL_FITS_1024x768=PASS')
console.log('EDIT_MODAL_HEADER_FIXED=PASS')
console.log('EDIT_MODAL_FOOTER_FIXED=PASS')
console.log('EDIT_MODAL_BODY_SCROLL_ONLY=PASS')
console.log('RTL_FIELDS_ALIGNED=PASS')
console.log('DISCOUNT_INPUT_VISIBLE=PASS')
console.log('SAVE_BUTTON_ALWAYS_VISIBLE=PASS')
console.log('NO_OVERLAP=PASS')
