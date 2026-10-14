import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'packages/pdf-engine/package.json'));
const wrapper = path.dirname(require.resolve('tesseract.js/package.json'));
const core = path.dirname(
  createRequire(path.join(wrapper, 'package.json')).resolve('tesseract.js-core/package.json'),
);
test('OCR-001 pins the unchanged worker/core and ships all selected-engine notices', async () => {
  for (const directory of [wrapper, core])
    assert.equal(
      JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')).version,
      '7.0.0',
    );
  const hashes = {
    'tesseract-core-lstm.wasm.js':
      'eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680',
    'tesseract-core-simd-lstm.wasm.js':
      'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38',
    'tesseract-core-relaxedsimd-lstm.wasm.js':
      '861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3',
  };
  for (const [file, expected] of Object.entries(hashes))
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(core, file)))
        .digest('hex'),
      expected,
    );
  assert.equal(
    createHash('sha256')
      .update(await readFile(path.join(wrapper, 'dist/worker.min.js')))
      .digest('hex'),
    '576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d',
  );
  const notice = await readFile(path.join(root, 'docs/dependencies/LOCAL_OCR_NOTICES.txt'), 'utf8');
  assert.match(notice, /This product includes software developed by the Independent JPEG Group/u);
  for (const component of [
    'Leptonica',
    'libpng',
    'libtiff',
    'libwebp',
    'OpenLibm',
    'zlib',
    'Emscripten',
  ])
    assert.ok(notice.toLowerCase().includes(component.toLowerCase()));
  const jsNotice = await readFile(
    path.join(root, 'docs/dependencies/LOCAL_OCR_JS_NOTICES.txt'),
    'utf8',
  );
  assert.ok(
    jsNotice.includes(await readFile(path.join(wrapper, 'dist/worker.min.js.LICENSE.txt'), 'utf8')),
  );
  const review = JSON.parse(
    await readFile(path.join(root, 'docs/dependencies/ocr-engine-review.json'), 'utf8'),
  );
  assert.equal(review.publicReleaseApproved, false);
  assert.equal(review.selectedRuntime.security.completeNativeVulnerabilityClearance, false);
});
