import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'packages/pdf-engine/package.json'));
const wrapper = path.dirname(require.resolve('tesseract.js/package.json'));
const core = path.dirname(
  createRequire(path.join(wrapper, 'package.json')).resolve('tesseract.js-core/package.json'),
);
for (const directory of [wrapper, core]) {
  if (JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')).version !== '7.0.0')
    throw new Error('OCR_VERSION_MISMATCH');
}
const workerBytes = await readFile(path.join(wrapper, 'dist/worker.min.js'));
if (
  createHash('sha256').update(workerBytes).digest('hex') !==
  '576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d'
)
  throw new Error('OCR_WORKER_ASSET_MISMATCH');
const models = [
  ['eng', '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2', 4113088],
  ['fra', 'ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca', 1130365],
];
const coreHashes = {
  'tesseract-core-lstm.wasm.js': 'eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680',
  'tesseract-core-simd-lstm.wasm.js':
    'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38',
  'tesseract-core-relaxedsimd-lstm.wasm.js':
    '861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3',
};
for (const location of ['apps/web/public/ocr', 'apps/desktop/public/ocr']) {
  const destination = path.join(root, location);
  await mkdir(destination, { recursive: true });
  for (const [file, expected] of Object.entries(coreHashes)) {
    const bytes = await readFile(path.join(core, file));
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error('OCR_CORE_ASSET_MISMATCH');
    await writeFile(path.join(destination, file), bytes);
  }
  await writeFile(path.join(destination, 'worker.min.js'), workerBytes);
  await writeFile(
    path.join(destination, 'worker.min.js.LICENSE.txt'),
    await readFile(path.join(wrapper, 'dist/worker.min.js.LICENSE.txt')),
  );
  await writeFile(
    path.join(destination, 'NOTICES.txt'),
    [
      await readFile(path.join(root, 'docs/dependencies/LOCAL_OCR_NOTICES.txt'), 'utf8'),
      await readFile(path.join(root, 'docs/dependencies/LOCAL_OCR_JS_NOTICES.txt'), 'utf8'),
    ].join('\n'),
  );
  for (const [language, expected, size] of models) {
    const file = path.join(destination, `${language}.traineddata`);
    let bytes;
    try {
      bytes = await readFile(file);
    } catch {
      /* First build fetches fixed public model assets, never documents. */
    }
    if (
      !bytes ||
      bytes.length !== size ||
      createHash('sha256').update(bytes).digest('hex') !== expected
    ) {
      const response = await fetch(
        `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/${language}.traineddata`,
        { signal: AbortSignal.timeout(60_000), redirect: 'error' },
      );
      if (!response.ok || !response.body) throw new Error('OCR_MODEL_DOWNLOAD_FAILED');
      bytes = new Uint8Array(size);
      const reader = response.body.getReader();
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (chunk.value.length > size - length) throw new Error('OCR_MODEL_DOWNLOAD_LIMIT');
          bytes.set(chunk.value, length);
          length += chunk.value.length;
        }
        if (length !== size) throw new Error('OCR_MODEL_ASSET_MISMATCH');
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (createHash('sha256').update(bytes).digest('hex') !== expected)
        throw new Error('OCR_MODEL_ASSET_MISMATCH');
      await writeFile(file, bytes);
    }
  }
}
console.log(
  'Prepared verified local OCR assets for Web and Windows; no runtime CDN or document upload.',
);
