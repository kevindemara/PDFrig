// Synthetic-only candidate smoke. This is not native security clearance or runtime adoption.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
const receipt = JSON.parse(
  await readFile(path.join(path.dirname(candidate), 'candidate-build.json'), 'utf8'),
);
const pins = JSON.parse(
  await readFile(path.join(root, 'docs/dependencies/ocr-minimal-candidate.json'), 'utf8'),
);
assert.equal(receipt.publicReleaseApproved, false);
assert.equal(receipt.runtimeReplacementApproved, false);
assert.deepEqual(receipt.sourcePins, pins.sources);
assert.equal(
  receipt.modifiedRecodebeamSha256,
  '785a24665e61242d74608abf85f0de9b4e1af8295da7a4553cfa0d27f47ecc43',
);
assert.equal(receipt.recodeNodeOwnershipTests.cycles, 1000);
assert.deepEqual(receipt.recodeNodeOwnershipTests.sanitizers, ['address', 'undefined']);
assert.equal(receipt.recodeNodeOwnershipTests.patchedWarningsAsErrors, true);
assert.deepEqual(receipt.recodeNodeOwnershipTests.results, [
  { source: 'original-control', exitCode: 17 },
  { source: 'patched', exitCode: 0 },
]);
assert.equal(
  receipt.nativeP6PreflightSha256,
  createHash('sha256')
    .update(await readFile(path.join(root, 'scripts/ocr-candidate-p6.h')))
    .digest('hex'),
);
assert.equal(
  receipt.modifiedBaseapiSha256,
  'dbe5d76fb88a318fdf2ea329727c3e65b200ff19919252df929e2f630bd03d84',
);
assert.deepEqual(receipt.nativeP6PreflightTests.sanitizers, ['address', 'undefined']);
assert.equal(receipt.nativeP6PreflightTests.prefixMutations, 131325);
assert.equal(receipt.nativeP6PreflightTests.deterministicMutations, 10000);
assert.equal(receipt.nativeP6PreflightTests.allTruncations, true);
assert.equal(receipt.nativeP6PreflightTests.exactPixelLimit, 20_000_000);
assert.equal(receipt.nativeP6PreflightTests.warningsAsErrors, true);
assert.equal(receipt.sha256, createHash('sha256').update(coreBytes).digest('hex'));
assert.equal(receipt.sha256, pins.evidence.sha256);
assert.equal(coreBytes.length, pins.evidence.bytes);
assert.equal(receipt.leptonicaPrivateLayouts, false);
assert.equal(
  receipt.modifiedGlueSha256,
  'ff43f4d087fa32864cf6eef8aef86bc0c4b0dba7b68566be024aec904a360906',
);
assert.equal(
  receipt.modifiedModelLoaderSha256,
  'bd5e48bb3d3de33fc3d2130dffcefa613caec1904d33c310cb585b848cde3abe',
);
assert.equal(
  receipt.nativeModelPreflightSha256,
  createHash('sha256')
    .update(await readFile(path.join(root, 'scripts/ocr-candidate-model.h')))
    .digest('hex'),
);
assert.deepEqual(receipt.nativeModelPreflightTests.sanitizers, ['address', 'undefined']);
assert.equal(receipt.nativeModelPreflightTests.warningsAsErrors, true);
assert.equal(receipt.nativeModelPreflightTests.directoryByteMutations, 50176);
assert.equal(receipt.nativeModelPreflightTests.deterministicMutations, 10000);
assert.equal(receipt.publicApiSelftestCycles, 100);
assert.equal(receipt.deniedRawOwnershipBindings.length, 25);
assert.equal(new Set(receipt.deniedRawOwnershipBindings).size, 25);
const factory = createRequire(import.meta.url)(candidate);
const imageBindings = [
  'SetInputImage_1',
  'TesseractRect_7',
  'SetImage_1',
  'SetImage_5',
  'ProcessPages_4',
  'ProcessPage_6',
].map((name) => `emscripten_bind_TessBaseAPI_${name}`);
assert.deepEqual(receipt.deniedAlternateImageBindings, imageBindings);
for (const name of imageBindings) {
  // Fresh instances: abort intentionally invalidates that instance. Use a real
  // owned API and valid in-bounds storage, not a null-pointer failure as proof.
  const isolated = await factory({ printErr: () => undefined });
  const ownedApi = new isolated.TessBaseAPI();
  const pointer = isolated._malloc(128);
  assert.ok(ownedApi.ptr > 0 && pointer > 0);
  for (let index = 0; index < 128; index++) isolated.setValue(pointer + index, 0, 'i8');
  assert.throws(
    () => isolated[`_${name}`](ownedApi.ptr, pointer, pointer, 1, 1, 1, 1, 1, 1),
    WebAssembly.RuntimeError,
  );
}
const native = await factory({ printErr: () => undefined });
const rendererBindings = [
  'TessPDFRenderer_3',
  'BeginDocument_1',
  'AddImage_1',
  'EndDocument_0',
  'happy_0',
  'file_extension_0',
  'title_0',
  'imagenum_0',
  '__destroy___0',
].map((name) => `emscripten_bind_TessPDFRenderer_${name}`);
assert.deepEqual(receipt.deniedRendererBindings, rendererBindings);
for (const name of rendererBindings) {
  const isolated = await factory({ printErr: () => undefined });
  const pointer = isolated._malloc(128);
  for (let index = 0; index < 128; index++) isolated.setValue(pointer + index, 0, 'i8');
  assert.throws(() => isolated[`_${name}`](pointer, pointer, 1), WebAssembly.RuntimeError);
}
assert.equal(native._pdfrig_candidate_leptonica_selftest(), 1);
const modelBindings = ['Init_2', 'ReadConfigFile_1', 'ReadDebugConfigFile_1'].map(
  (name) => `emscripten_bind_TessBaseAPI_${name}`,
);
assert.deepEqual(receipt.deniedModelBindings, modelBindings);
for (const name of modelBindings) {
  const isolated = await factory({ printErr: () => undefined });
  const ownedApi = new isolated.TessBaseAPI();
  const pointer = isolated._malloc(128);
  assert.ok(ownedApi.ptr > 0 && pointer > 0);
  for (let index = 0; index < 128; index++) isolated.setValue(pointer + index, 0, 'i8');
  assert.throws(
    () => isolated[`_${name}`](ownedApi.ptr, pointer, pointer, 1),
    WebAssembly.RuntimeError,
  );
}
const outputBindings = [
  'GetInputImage_0',
  'GetThresholdedImage_0',
  'GetRegions_1',
  'GetTextlines_2',
  'GetTextlines_5',
  'GetStrips_2',
  'GetWords_1',
  'GetConnectedComponents_1',
  'GetComponentImages_4',
  'GetComponentImages_7',
  'GetIterator_0',
].map((name) => `emscripten_bind_TessBaseAPI_${name}`);
assert.deepEqual(receipt.deniedRawOutputBindings, outputBindings);
for (const name of outputBindings) {
  const isolated = await factory({ printErr: () => undefined });
  const ownedApi = new isolated.TessBaseAPI();
  const pointer = isolated._malloc(128);
  assert.ok(ownedApi.ptr > 0 && pointer > 0);
  for (let index = 0; index < 128; index++) isolated.setValue(pointer + index, 0, 'i8');
  assert.throws(
    () => isolated[`_${name}`](ownedApi.ptr, pointer, pointer, pointer, pointer, pointer, pointer),
    WebAssembly.RuntimeError,
  );
}
const directoryFixture = (big = false) => {
  const bytes = Buffer.alloc(204, 120);
  bytes[big ? 'writeUInt32BE' : 'writeUInt32LE'](24, 0);
  for (let i = 0; i < 24; i++) bytes.fill(255, 4 + i * 8, 12 + i * 8);
  bytes[big ? 'writeBigUInt64BE' : 'writeBigUInt64LE'](196n, 4 + 17 * 8);
  bytes[big ? 'writeBigUInt64BE' : 'writeBigUInt64LE'](200n, 4 + 23 * 8);
  return bytes;
};
const directoryAllows = (bytes) => {
  if (bytes.length < 12 || bytes.length > 16777216) return false;
  let count = bytes.readUInt32LE(0);
  const big = count > 1000;
  if (big) count = bytes.readUInt32BE(0);
  if (!count || count > 24 || 4 + count * 8 >= bytes.length) return false;
  let previous;
  for (let i = 0; i < count; i++) {
    const offset = bytes[big ? 'readBigInt64BE' : 'readBigInt64LE'](4 + i * 8);
    if (offset === -1n) continue;
    if (
      offset < BigInt(4 + count * 8) ||
      offset >= BigInt(bytes.length) ||
      (previous === undefined ? offset !== BigInt(4 + count * 8) : offset <= previous)
    )
      return false;
    previous = offset;
  }
  return previous !== undefined;
};
let modelDirectoryCases = 0;
const checkDirectory = (bytes, expected, declaredSize = bytes.length) => {
  const pointer = native._malloc(Math.max(1, bytes.length));
  assert.ok(pointer > 0);
  try {
    for (let i = 0; i < bytes.length; i++) native.setValue(pointer + i, bytes[i], 'i8');
    assert.equal(native._pdfrig_candidate_model_directory(pointer, declaredSize), expected ? 1 : 0);
    modelDirectoryCases++;
  } finally {
    native._free(pointer);
  }
};
assert.equal(native._pdfrig_candidate_model_directory(0, 100), 0);
for (const big of [false, true]) {
  const bytes = directoryFixture(big);
  checkDirectory(bytes, true);
  checkDirectory(bytes, false, -1);
  checkDirectory(bytes, false, 16777217);
  for (let length = 0; length <= 196; length++) checkDirectory(bytes.subarray(0, length), false);
  for (let position = 0; position < 196; position++)
    for (const value of [0, 1, 127, 255]) {
      const changed = Buffer.from(bytes);
      changed[position] = value;
      checkDirectory(changed, directoryAllows(changed));
    }
}
for (const [language, sha256] of [
  ['eng', '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2'],
  ['fra', 'ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca'],
]) {
  const bytes = await readFile(path.join(root, `apps/web/public/ocr/${language}.traineddata`));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256);
  checkDirectory(bytes, true);
}
// Exercise the real WASM worker entry point, not only the standalone preflight.
// Layout-only init avoids model parsing in these format-boundary tests.
const api = new native.TessBaseAPI();
let rejectedImages = 0;
try {
  api.InitForAnalysePage();
  const valid = Buffer.concat([
    Buffer.from(`P6\n${' '.repeat(512)}3 2\n255\n`),
    Buffer.from([0, 10, 32, 255, 128, 0, 1, 18, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0]),
  ]);
  const setImage = (bytes, exif = 1, angle = 0) => {
    native.FS.writeFile('/input', bytes);
    return api.SetImageFile(exif, angle);
  };
  assert.equal(setImage(valid), 0);
  // Raw Pix output is deliberately unavailable. Successful admission is checked
  // here; actual recognition and bounding boxes are checked through worker JSON.
  const reject = (bytes, exif = 1, angle = 0) => {
    assert.equal(setImage(bytes, exif, angle), 1);
    rejectedImages++;
  };
  for (let length = 0; length < valid.length; length++) reject(valid.subarray(0, length));
  for (let offset = 0; offset < 515; offset++) {
    const changed = Buffer.from(valid);
    changed[offset] ^= 1;
    reject(changed);
  }
  for (const dimensions of ['0 2', '3 0', '03 2', '3\t2', '20000001 1', '99999999 99999999'])
    reject(Buffer.from(`P6\n${' '.repeat(512)}${dimensions}\n255\n${'x'.repeat(18)}`));
  for (const header of ['P3\n3 2\n255\n', 'P6\n3 2\n255\n', 'P7\n', '\x89PNG\r\n', 'BM'])
    reject(Buffer.concat([Buffer.from(header), Buffer.alloc(600)]));
  reject(Buffer.concat([valid, Buffer.from([0])]));
  reject(Buffer.concat([valid, valid]));
  reject(valid, 6);
  reject(valid, 1, 0.25);
  reject(valid, 1, NaN);
  assert.equal(setImage(valid), 0); // refusals do not poison the module instance
} finally {
  api.End();
  native.destroy(api);
  native.FS.unlink('/input');
}
for (const name of receipt.deniedRawOwnershipBindings) {
  assert.match(
    name,
    /^emscripten_bind_(?:Box|Boxa|PixColormap|Pta|Pix|Pixa)_(?:get_[a-z]+|__destroy__)_0$/u,
  );
  // abort poisons the module instance; use a fresh disposable instance for each call.
  const isolated = await factory({ printErr: () => undefined });
  assert.equal(typeof isolated[`_${name}`], 'function');
  // A real in-bounds allocation ensures this is an explicit API refusal, not
  // merely an invalid-address trap. No object may be read/freed by these calls.
  const pointer = isolated._malloc(128);
  assert.ok(pointer > 0);
  for (let index = 0; index < 128; index++) isolated.setValue(pointer + index, 0, 'i8');
  assert.throws(() => isolated[`_${name}`](pointer), WebAssembly.RuntimeError);
}
const legacyBindings = [
  'emscripten_bind_TessBaseAPI_ClearAdaptiveClassifier_0',
  'emscripten_bind_TessBaseAPI_GetOsdText_1',
  'emscripten_bind_TessBaseAPI_DetectOS_1',
  'emscripten_bind_OSResults_print_scores_0',
];
for (const name of legacyBindings) {
  const isolated = await factory({ printErr: () => undefined });
  assert.equal(typeof isolated[`_${name}`], 'function');
  assert.throws(() => isolated[`_${name}`](0, 0), WebAssembly.RuntimeError);
}
const assets = new Map([
  [
    '/engine/local-ocr-worker-client.js',
    path.join(root, 'packages/pdf-engine/dist/local-ocr-worker-client.js'),
  ],
  ['/engine/local-ocr-pixels.js', path.join(root, 'packages/pdf-engine/dist/local-ocr-pixels.js')],
  ['/engine/local-ocr-models.js', path.join(root, 'packages/pdf-engine/dist/local-ocr-models.js')],
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
    publicApiSelftestCycles: 100,
    deniedRawOwnershipBindingsTested: receipt.deniedRawOwnershipBindings.length,
    deniedAlternateImageBindingsTested: imageBindings.length,
    deniedRendererBindingsTested: rendererBindings.length,
    deniedModelBindingsTested: modelBindings.length,
    deniedRawOutputBindingsTested: outputBindings.length,
    nativeModelPreflightTests: receipt.nativeModelPreflightTests,
    actualModelDirectoryCases: modelDirectoryCases,
    pinnedModelDirectoriesAdmitted: 2,
    legacyApiTrapsTested: legacyBindings.length,
    recodeNodeOwnershipTests: receipt.recodeNodeOwnershipTests,
    nativeP6PreflightTests: receipt.nativeP6PreflightTests,
    rejectedImagesThroughActualWasmEntry: rejectedImages,
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
