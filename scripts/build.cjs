const { execFileSync } = require('node:child_process')

const buildSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const env = { ...process.env, VITE_BUILD_SHA: buildSha }

if (process.platform === 'win32') execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm exec -- vite build'], { stdio: 'inherit', env })
else execFileSync('npm', ['exec', '--', 'vite', 'build'], { stdio: 'inherit', env })
execFileSync(process.execPath, ['scripts/finalize-dist.cjs'], { stdio: 'inherit', env })
execFileSync(process.execPath, ['scripts/generate-deploy-meta.cjs'], { stdio: 'inherit', env })
