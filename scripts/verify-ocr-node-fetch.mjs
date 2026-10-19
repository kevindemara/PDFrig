// Synthetic-only regression for removing Tesseract's legacy Node fetch fallback.
// Uses the existing pinned runtime, not the research candidate or user documents.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'packages/pdf-engine/package.json'));
const { createWorker } = require('tesseract.js');
const image = await readFile(
  path.join(root, 'packages/test-corpus/fixtures/sources/scanned-ocr.png'),
);
const assets = new Map([
  ['/synthetic.png', image],
  ...(await Promise.all(
    ['eng', 'fra'].map(async (language) => [
      `/${language}.traineddata`,
      await readFile(path.join(root, `apps/web/public/ocr/${language}.traineddata`)),
    ]),
  )),
]);
const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  const asset = assets.get(request.url);
  if (request.method !== 'GET' || !asset) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(asset);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let worker;
const deadline = setTimeout(() => {
  console.error('OCR_NODE_FETCH_DEADLINE');
  process.exit(1);
}, 120_000);
try {
  const results = [];
  for (const language of ['eng', 'fra']) {
    worker = await createWorker(language, 1, { langPath: base, gzip: false, cacheMethod: 'none' });
    const result = await worker.recognize(base + '/synthetic.png', {}, { text: true });
    // Fixed public CC0 fixture marker. Never log recognized text.
    assert.match(result.data.text, /OCR\s+FIXTURE/u);
    await worker.terminate();
    worker = undefined;
    results.push({ language, markerMatched: true });
  }
  assert.deepEqual(
    requests.sort(),
    ['/eng.traineddata', '/fra.traineddata', '/synthetic.png', '/synthetic.png'].sort(),
  );
  console.log(
    JSON.stringify({
      featureId: 'OCR-001',
      builtInFetch: true,
      results,
      localModelRequests: 2,
      localImageRequests: 2,
      cacheWrites: false,
      scope:
        'Unchanged Node adapters and pinned current runtime, synthetic local HTTP assets only; not native security clearance.',
    }),
  );
} finally {
  clearTimeout(deadline);
  await worker?.terminate();
  await new Promise((resolve) => server.close(resolve));
}
