// Explicit research command only. Never replaces application assets or builds Windows code.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pins = JSON.parse(
  await readFile(path.join(root, 'docs/dependencies/ocr-minimal-candidate.json'), 'utf8'),
);
if (pins.publicReleaseApproved !== false || pins.runtimeReplacementApproved !== false)
  throw new Error('OCR_CANDIDATE_APPROVAL_DRIFT');
if (
  !/^emscripten\/emsdk@sha256:[a-f0-9]{64}$/u.test(pins.toolchain.image) ||
  pins.sources.map((source) => source.id).join(',') !== 'core,tesseract,leptonica'
)
  throw new Error('OCR_CANDIDATE_SOURCE_INVALID');
await mkdir(path.join(root, 'tmp'), { recursive: true });
const output = await mkdtemp(path.join(root, 'tmp/ocr-minimal-'));
for (const source of pins.sources) {
  if (
    !/^[a-z]+$/u.test(source.id) ||
    !/^[a-f0-9]{40}$/u.test(source.commit) ||
    source.url !== `https://codeload.github.com/${source.repo}/tar.gz/${source.commit}` ||
    !Number.isSafeInteger(source.bytes) ||
    source.bytes <= 0 ||
    source.bytes > 64 * 1024 * 1024
  )
    throw new Error('OCR_CANDIDATE_SOURCE_INVALID');
  const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error('OCR_CANDIDATE_SOURCE_FETCH_FAILED');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > source.bytes) throw new Error('OCR_CANDIDATE_SOURCE_LIMIT');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (
    bytes.length !== source.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== source.sha256
  )
    throw new Error('OCR_CANDIDATE_SOURCE_MISMATCH');
  await writeFile(path.join(output, `${source.id}.tar.gz`), bytes, { flag: 'wx' });
}
await copyFile(path.join(root, 'scripts/ocr-minimal-build.py'), path.join(output, 'build.py'));
await copyFile(
  path.join(root, 'scripts/ocr-candidate-bindings.py'),
  path.join(output, 'ocr_candidate_bindings.py'),
);
await copyFile(
  path.join(root, 'scripts/ocr-candidate-bindings-test.py'),
  path.join(output, 'bindings_test.py'),
);
await writeFile(path.join(output, 'source-pins.json'), JSON.stringify(pins, null, 2));
console.log(
  `OCR research inputs: ${path.relative(root, output)}. Application assets remain unchanged.`,
);
const cidFile = path.join(output, 'container.cid');
try {
  execFileSync(
    'docker',
    [
      'run',
      '--pull',
      'never',
      '--cidfile',
      cidFile,
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '65532:65532',
      '--pids-limit',
      '256',
      '--memory',
      '4g',
      '--cpus',
      '4',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=512m',
      '--mount',
      `type=bind,source=${output},target=/work`,
      '--workdir',
      '/work',
      '--env',
      'EM_CACHE=/work/em-cache',
      '--env',
      'PYTHONDONTWRITEBYTECODE=1',
      '--env',
      'SOURCE_DATE_EPOCH=1765411200',
      '--entrypoint',
      'python3',
      pins.toolchain.image,
      '/work/build.py',
    ],
    { stdio: 'inherit', windowsHide: true, timeout: 30 * 60_000 },
  );
} finally {
  // The fresh cidfile identifies only this invocation's disposable container,
  // including when the attached CLI times out. Never stop unrelated containers.
  const id = await readFile(cidFile, 'utf8').catch(() => '');
  if (/^[a-f0-9]{64}$/u.test(id.trim())) {
    try {
      execFileSync('docker', ['rm', '--force', id.trim()], {
        stdio: 'pipe',
        windowsHide: true,
        timeout: 15_000,
      });
    } catch {
      /* --rm normally removed the container already. */
    }
  }
}
