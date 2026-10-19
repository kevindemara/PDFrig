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

test('OCR-001 minimal research build is pinned, isolated and never substitutes application assets', async () => {
  const pins = JSON.parse(
    await readFile(path.join(root, 'docs/dependencies/ocr-minimal-candidate.json'), 'utf8'),
  );
  assert.equal(pins.publicReleaseApproved, false);
  assert.equal(pins.runtimeReplacementApproved, false);
  assert.equal(pins.evidence.leptonicaPrivateLayouts, false);
  assert.equal(pins.evidence.publicApiSelftestCycles, 100);
  assert.equal(pins.evidence.deniedRawOwnershipBindingsTested, 25);
  assert.equal(pins.evidence.legacyApiTrapsTested, 4);
  assert.equal(pins.apiSecurityReview.completeNativeVulnerabilityClearance, false);
  assert.match(pins.toolchain.image, /^emscripten\/emsdk@sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(
    pins.sources.map((source) => source.id),
    ['core', 'tesseract', 'leptonica'],
  );
  for (const source of pins.sources) {
    assert.match(source.commit, /^[a-f0-9]{40}$/u);
    assert.match(source.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(source.url, `https://codeload.github.com/${source.repo}/tar.gz/${source.commit}`);
  }
  const script = await readFile(path.join(root, 'scripts/prepare-ocr-minimal.mjs'), 'utf8');
  for (const guard of [
    "'--pull', 'never'",
    "'--network', 'none'",
    "'--read-only'",
    "'--cap-drop', 'ALL'",
    "'--user', '65532:65532'",
    "'--memory', '4g'",
    "'--pids-limit', '256'",
  ])
    assert.ok(script.replaceAll(/\s+/gu, ' ').includes(guard));
  assert.ok(script.includes("'--cidfile'"));
  assert.ok(script.includes("['rm', '--force', id.trim()]"));
  assert.doesNotMatch(
    script,
    /apps\/(?:web|desktop)\/public|tauri|powershell|WindowsCertificate/iu,
  );
  const build = await readFile(path.join(root, 'scripts/ocr-minimal-build.py'), 'utf8');
  assert.ok(build.includes('ERROR_ON_UNDEFINED_SYMBOLS=1'));
  assert.ok(build.includes('OCR_CANDIDATE_PATCH_DRIFT'));
  assert.ok(build.includes("'--parallel', '4'"));
  assert.ok(build.includes('MAXIMUM_MEMORY=1073741824'));
  assert.doesNotMatch(build, /#include.*pix_internal/u);
  assert.ok(build.includes('patch_bindings(glue)'));
  assert.ok(build.includes("run('python3', str(work / 'bindings_test.py'))"));
  const bindings = await readFile(path.join(root, 'scripts/ocr-candidate-bindings.py'), 'utf8');
  assert.ok(bindings.includes('boxGetGeometry'));
  assert.ok(bindings.includes('pixGetWidth'));
  assert.ok(bindings.includes('unsupported raw/ownership API'));
  assert.ok(bindings.includes('OCR_CANDIDATE_BINDING_DRIFT'));
});
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
