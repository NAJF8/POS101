const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const out = path.join(root, 'out');
for (const name of ['fixture-invoice', 'fixture-report']) {
  const p = path.join(out, `${name}.bin`);
  assert.ok(fs.existsSync(p), `missing ${p}; run render/rasterize first`);
  const b = fs.readFileSync(p);
  assert.deepStrictEqual([...b.subarray(0, 2)], [0x1b, 0x40], `${name}: missing ESC/POS init`);
  assert.deepStrictEqual([...b.subarray(-3)], [0x1d, 0x56, 0x00], `${name}: cut is not last command`);
  assert.strictEqual([...b].filter((v, i) => v === 0x1d && b[i + 1] === 0x56).length, 1, `${name}: more than one cut`);
  assert.deepStrictEqual([...b.subarray(-6, -3).slice(0, 2)], [0x1b, 0x64], `${name}: feed is not immediately before cut`);
}
const results = JSON.parse(fs.readFileSync(path.join(out, 'render-results.json'), 'utf8'));
assert.ok(results.results.every(r => r.widthDots === results.profile.printableWidthDots));
assert.strictEqual(results.profile.verified, false);
console.log('PASS: raster width, single final cut, feed-before-cut, and unverified calibration gate');
