// Synthetic-only candidate smoke. This is not native security clearance or runtime adoption.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const candidate = await realpath(path.resolve(process.argv[2] ?? ''));
const relative = path.relative(path.join(root, 'tmp'), candidate);
assert.ok(
  !relative.startsWith('..') && !path.isAbsolute(relative) && relative.startsWith('ocr-minimal-'),
);
assert.match(candidate, /tesseract-core-lstm\.wasm\.(?:js|cjs)$/u);
const coreBytes = await readFile(candidate);
const assets = new Map([
  [
    '/engine/local-ocr-worker-client.js',
    path.join(root, 'packages/pdf-engine/dist/local-ocr-worker-client.js'),
  ],
  ['/engine/local-ocr-pixels.js', path.join(root, 'packages/pdf-engine/dist/local-ocr-pixels.js')],
  ...['worker.min.js', 'eng.traineddata', 'fra.traineddata'].map((file) => [
    `/ocr/${file}`,
    path.join(root, 'apps/web/public/ocr', file),
  ]),
]);
const corePaths = new Set(
  ['', '-simd', '-relaxedsimd'].map((variant) => `/ocr/tesseract-core${variant}-lstm.wasm.js`),
);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (
    request.method !== 'GET' ||
    (pathname !== '/' && !assets.has(pathname) && !corePaths.has(pathname))
  ) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; object-src 'none'",
  );
  response.setHeader(
    'Content-Type',
    pathname === '/'
      ? 'text/html'
      : pathname.endsWith('.js')
        ? 'text/javascript'
        : 'application/octet-stream',
  );
  try {
    response.end(
      pathname === '/'
        ? '<!doctype html><title>PDFrig synthetic OCR candidate QA</title>'
        : corePaths.has(pathname)
          ? coreBytes
          : await readFile(assets.get(pathname)),
    );
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const errors = [],
    outbound = [];
  context.on('request', (request) => {
    if (!request.url().startsWith(base + '/') || request.method() !== 'GET')
      outbound.push('unexpected-request');
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.name));
  await page.goto(base);
  const results = [];
  for (const language of ['eng', 'fra']) {
    const result = await page.evaluate(
      async ({ language, base }) => {
        const { encodeOcrPixels } = await import(base + '/engine/local-ocr-pixels.js');
        const { runLocalOcrWorker } = await import(base + '/engine/local-ocr-worker-client.js');
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 240;
        const context = canvas.getContext('2d');
        context.fillStyle = 'white';
        context.fillRect(0, 0, 1200, 240);
        context.fillStyle = 'black';
        context.font = 'bold 64px Arial';
        context.fillText('OCR FIXTURE 4827', 40, 90);
        context.fillText(language === 'fra' ? 'BONJOUR 4827' : 'HELLO 4827', 40, 180);
        const signal = new AbortController().signal;
        const pixels = context.getImageData(0, 0, 1200, 240).data;
        // Synthetic hostile pixel pattern in the top margin: must not be
        // interpreted by the unchanged JS wrapper as EXIF orientation 6.
        const forged = [1, 18, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0];
        for (let index = 0; index < forged.length; index++)
          pixels[Math.floor(index / 3) * 4 + (index % 3)] = forged[index];
        const raster = encodeOcrPixels(1200, 240, pixels, signal);
        const start = performance.now();
        const raw = await runLocalOcrWorker(
          raster,
          language,
          base + '/ocr/',
          signal,
          () => undefined,
        );
        return {
          language,
          markerMatched: /OCR\s+FIXTURE\s+4827/u.test(raw.text),
          greetingMatched: raw.text.includes(language === 'fra' ? 'BONJOUR' : 'HELLO'),
          pixelForgedExifIgnored: !raster
            .slice(0, 500)
            .join(' ')
            .match(/1 18 0 3 0 0 0 1 0 (\d)/u),
          blocks: raw.blocks.length,
          elapsedMs: Math.round(performance.now() - start),
        };
      },
      { language, base },
    );
    assert.equal(result.markerMatched, true);
    assert.equal(result.greetingMatched, true);
    assert.equal(result.pixelForgedExifIgnored, true);
    assert.ok(result.blocks > 0);
    results.push(result);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  const report = {
    schemaVersion: 1,
    publicReleaseApproved: false,
    runtimeReplacementApproved: false,
    variant: 'baseline-lstm-served-for-all-worker-feature-choices',
    sha256: createHash('sha256').update(coreBytes).digest('hex'),
    bytes: coreBytes.length,
    results,
    unexpectedRequests: outbound.length,
    pageErrors: errors.length,
    scope:
      'Synthetic baseline browser recognition only; SIMD variants, broader accuracy, final export compatibility and exact-binary security review remain gates.',
  };
  const output = path.join(path.dirname(candidate), `candidate-smoke-${Date.now()}.json`);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
