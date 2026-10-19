import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const engineRequire = createRequire(path.join(root, 'packages/pdf-engine/package.json'));
const wrapper = path.dirname(engineRequire.resolve('tesseract.js/package.json'));
const require = createRequire(path.join(wrapper, 'package.json'));

test('OCR-001 excludes only the unused legacy fetch fallback on supported Node', async () => {
  assert.equal(typeof globalThis.fetch, 'function');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.engines.node, '>=22.13.0');
  assert.throws(() => require.resolve('node-fetch'), { code: 'MODULE_NOT_FOUND' });
  const lock = await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  assert.match(lock, /tesseract\.js@7\.0\.0>node-fetch: '-'/u);
  assert.doesNotMatch(
    lock,
    /^ {2}(?:node-fetch@2\.7\.0|whatwg-url@5\.0\.0|tr46@0\.0\.3|webidl-conversions@3\.0\.1):/mu,
  );
  for (const [file, hash] of [
    [
      'src/worker/node/loadImage.js',
      'fe47eb386a2a802b2621abec973e191fb9a0d9609dcf633dce085f82621d287f',
    ],
    [
      'src/worker-script/node/index.js',
      'a973c23ce067bc752c0bf602297eac843098e531ac03f3ea34cdf694326a6d02',
    ],
  ]) {
    const bytes = await readFile(path.join(wrapper, file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
    assert.ok(bytes.toString().includes("global.fetch || require('node-fetch')"));
  }
});

test('OCR-001 unchanged Node image adapter uses built-in fetch and preserves binary input', async () => {
  const expected = Buffer.from([80, 54, 10, 49, 32, 49, 10, 50, 53, 53, 10, 0, 127, 255]);
  let requests = 0;
  const server = createServer((request, response) => {
    assert.equal(request.url, '/synthetic.ppm');
    requests++;
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(expected);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const loadImage = require('./src/worker/node/loadImage.js');
    const remote = await loadImage(`http://127.0.0.1:${server.address().port}/synthetic.ppm`);
    assert.deepEqual(Buffer.from(remote), expected);
    assert.deepEqual(Buffer.from(await loadImage(expected)), expected);
    assert.equal(requests, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
