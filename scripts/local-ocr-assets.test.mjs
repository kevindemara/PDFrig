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
  assert.equal(pins.evidence.deniedAlternateImageBindingsTested, 6);
  assert.equal(pins.evidence.legacyApiTrapsTested, 4);
  assert.equal(pins.apiSecurityReview.completeNativeVulnerabilityClearance, false);
  assert.equal(
    pins.recodeNodeBackport.sha256,
    '52cb49e0bf288160d5a6b892f5060014a66681e3180010a7cd84a901210b0347',
  );
  const recode = await readFile(path.join(root, 'scripts/ocr-candidate-recode.py'), 'utf8');
  for (const guard of [
    'OCR_CANDIDATE_RECODE_SOURCE_DRIFT',
    '-fsanitize=address,undefined',
    "flags.append('-Werror')",
    "('original-control', original, 17)",
  ])
    assert.ok(recode.includes(guard));
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
  assert.ok(build.includes('patch_input_apis(glue)'));
  assert.ok(build.includes("'deniedAlternateImageBindings': denied_image_bindings"));
  assert.ok(build.includes('patch_baseapi(baseapi_path.read_bytes())'));
  assert.ok(build.includes('p6_tests = test_preflight(work)'));
  assert.ok(build.includes("run('python3', str(work / 'bindings_test.py'))"));
  const bindings = await readFile(path.join(root, 'scripts/ocr-candidate-bindings.py'), 'utf8');
  assert.ok(bindings.includes('boxGetGeometry'));
  assert.ok(bindings.includes('pixGetWidth'));
  assert.ok(bindings.includes('unsupported raw/ownership API'));
  assert.ok(bindings.includes('OCR_CANDIDATE_BINDING_DRIFT'));
  assert.ok(bindings.includes('OCR_CANDIDATE_IMAGE_API_DRIFT'));
});

test('OCR-001 research native image preflight is exact, bounded and hash-bound', async () => {
  const read = (name) => readFile(path.join(root, 'scripts', name), 'utf8');
  const patch = await read('ocr-candidate-p6.py');
  for (const guard of [
    '13e4b10e89549b70fe9c89c24a4590241d9c880fdcd116ef33de963da91856f1',
    'OCR_CANDIDATE_P6_SOURCE_DRIFT',
    'pixReadStreamPnm(input)',
    'exif != 1 || angle != 0.0f',
    '-fsanitize=address,undefined',
    '-Werror',
  ])
    assert.ok(patch.includes(guard));
  const preflight = await read('ocr-candidate-p6.h');
  const candidate = JSON.parse(
    await readFile(path.join(root, 'docs/dependencies/ocr-minimal-candidate.json'), 'utf8'),
  );
  assert.equal(
    candidate.evidence.nativeP6PreflightSha256,
    createHash('sha256').update(preflight).digest('hex'),
  );
  assert.equal(candidate.evidence.nativeP6PreflightVerification.exactPixelLimit, 20_000_000);
  assert.equal(
    candidate.evidence.nativeP6PreflightVerification.rejectedImagesThroughActualWasmEntry,
    1072,
  );
  assert.ok(preflight.includes('pixels > 20000000'));
  assert.ok(preflight.includes('digits > 8'));
  assert.ok(preflight.includes('prefix[515]'));
  assert.ok(preflight.includes('std::uint64_t(header) + pixels * 3'));
  assert.doesNotMatch(preflight, /malloc|new |pixRead|sscanf|atoi/u);
  const verify = await read('verify-ocr-minimal.mjs');
  assert.ok(verify.includes('api.SetImageFile(exif, angle)'));
  assert.ok(verify.includes('reject(valid, 1, NaN)'));
  assert.ok(verify.includes('rejectedImagesThroughActualWasmEntry'));
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
