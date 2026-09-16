const fs = require('node:fs')
const path = require('node:path')

const distDir = path.resolve(__dirname, '..', 'dist')
const generatedHtml = path.join(distDir, 'src-index.html')
const targetHtml = path.join(distDir, 'index.html')

if (fs.existsSync(generatedHtml)) {
  if (fs.existsSync(targetHtml)) fs.rmSync(targetHtml)
  fs.renameSync(generatedHtml, targetHtml)
}
