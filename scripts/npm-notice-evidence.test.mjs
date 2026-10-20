import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  boundedRegistryFetch,
  installedNpmEvidence,
  npmTreeEvidence,
  publishedNpmEvidence,
} from './npm-notice-evidence.mjs';

test('installed evidence sees all regular files and detects same-length mutations', async () => {
  const base = fileURLToPath(new URL('../tmp/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'npm-notice-evidence-'));
  await mkdir(path.join(directory, 'nested'));
  await writeFile(path.join(directory, 'nested/a.txt'), 'old');
  await writeFile(path.join(directory, '.hidden'), 'attribution');
  const before = npmTreeEvidence(await installedNpmEvidence(directory));
  await writeFile(path.join(directory, 'nested/a.txt'), 'new');
  const after = npmTreeEvidence(await installedNpmEvidence(directory));
  assert.equal(before.files, 2);
  assert.equal(before.bytes, after.bytes);
  assert.notEqual(before.sha256, after.sha256);
});

function tarEntry(name, { type = '0', body = Buffer.from('example'), size = body.length } = {}) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12);
  header.fill(32, 148, 156);
  header[156] = type.charCodeAt(0);
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}
function archive(entries, { terminator = 1024 } = {}) {
  const bytes = gzipSync(Buffer.concat([...entries, Buffer.alloc(terminator)]));
  return [bytes, `sha512-${createHash('sha512').update(bytes).digest('base64')}`];
}

test('published npm evidence binds complete payload content, names and lengths', () => {
  const files = publishedNpmEvidence(
    ...archive([tarEntry('package/index.js'), tarEntry('package/a.txt')]),
  );
  assert.equal(files.size, 2);
  assert.equal(files.get('index.js').bytes, 7);
  const evidence = npmTreeEvidence(files);
  assert.deepEqual(npmTreeEvidence(new Map([...files].reverse())), evidence);
  assert.notEqual(
    npmTreeEvidence(new Map([['renamed', files.get('index.js')]])).sha256,
    evidence.sha256,
  );
});

test('npm evidence refuses corrupt integrity, compression, checksum and termination', () => {
  const [bytes, integrity] = archive([tarEntry('package/index.js')]);
  assert.throws(() => publishedNpmEvidence(bytes, integrity.replace('sha512-', 'sha1-')));
  assert.throws(() => publishedNpmEvidence(Buffer.from('not gzip'), integrity));
  const invalidGzip = Buffer.from('not gzip');
  assert.throws(() =>
    publishedNpmEvidence(
      invalidGzip,
      `sha512-${createHash('sha512').update(invalidGzip).digest('base64')}`,
    ),
  );
  const corrupted = tarEntry('package/index.js');
  corrupted[1] ^= 1;
  for (const args of [
    archive([corrupted]),
    archive([tarEntry('package/a')], { terminator: 512 }),
    archive([tarEntry('package/a', { size: 5000 })]),
    archive([]),
  ])
    assert.throws(() => publishedNpmEvidence(...args));
});

test('npm evidence never extracts links, special files, extensions or unsafe paths', () => {
  for (const type of ['1', '2', '3', '4', '6', 'x', 'g', 'L', 'K'])
    assert.throws(() => publishedNpmEvidence(...archive([tarEntry('package/a', { type })])));
  for (const name of [
    '/package/a',
    'package/../a',
    'package//a',
    'package/./a',
    'other/a',
    'package/a\\b',
    'package/C:a',
    'package/a\nb',
  ])
    assert.throws(() => publishedNpmEvidence(...archive([tarEntry(name)])));
  assert.throws(() =>
    publishedNpmEvidence(...archive([tarEntry('package/a'), tarEntry('package/a')])),
  );
});

test('npm evidence enforces file count and per-file bounds', () => {
  assert.throws(() =>
    publishedNpmEvidence(...archive([tarEntry('package/a', { size: 67108865 })])),
  );
  assert.throws(() =>
    publishedNpmEvidence(
      ...archive(
        Array.from({ length: 2049 }, (_, i) => tarEntry(`package/${i}`, { body: Buffer.alloc(0) })),
      ),
    ),
  );
});

test('registry review refuses non-registry origins without making a request', async () => {
  for (const maximum of [undefined, -1, 0, 40 * 1024 * 1024 + 1, Infinity])
    await assert.rejects(boundedRegistryFetch('https://registry.npmjs.org/x', maximum));
  for (const url of [
    'http://registry.npmjs.org/x',
    'https://example.com/x',
    'https://registry.npmjs.org.example.com/x',
    'https://user:secret@registry.npmjs.org/x',
  ])
    await assert.rejects(boundedRegistryFetch(url, 10));
});

test('active provenance reviews cannot silently clear the existing notice gate', async () => {
  const review = JSON.parse(
    await readFile(new URL('../docs/dependencies/windows-npm-notice-review.json', import.meta.url)),
  );
  const all = JSON.parse(
    await readFile(new URL('../docs/dependencies/desktop-notice-review.json', import.meta.url)),
  );
  const gaps = all.remainingGroups.find((group) => group.id === 'npm-and-optional-native').packages;
  assert.equal(review.publicReleaseApproved, false);
  assert.equal(review.allNoticesComplete, false);
  assert.equal(review.packages.length, 1);
  assert.equal(review.removedInputs[0].name, 'tr46');
  assert.equal(review.removedInputs[0].licenseCleared, false);
  assert.deepEqual(
    review.packages.map((entry) => `${entry.name}@${entry.version}`),
    gaps,
  );
  for (const entry of review.packages) {
    assert.equal(entry.noticeComplete, false);
    assert.match(entry.archiveSha256, /^[a-f0-9]{64}$/u);
    assert.match(entry.tree.sha256, /^[a-f0-9]{64}$/u);
    assert.match(entry.manifestSha256, /^[a-f0-9]{64}$/u);
    assert.ok(entry.nextAction.length > 70);
  }
});

test('signature dependencies are removed, not retroactively licensed or cleared in older installers', async () => {
  const load = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const review = JSON.parse(await load('docs/dependencies/windows-npm-notice-review.json'));
  const engine = JSON.parse(await load('packages/pdf-engine/package.json'));
  const signature = await load('packages/pdf-engine/src/signature-font.ts');
  assert.equal(review.dependencyUseReviewAtBaseline.publishedAndInstalledPayloadsMatched, 4);
  assert.equal(engine.dependencies.fontkit, undefined);
  assert.ok(!signature.includes("import('fontkit')"));
  const lock = await load('pnpm-lock.yaml');
  for (const name of ['fontkit', 'dfa', 'brotli']) {
    assert.ok(!lock.includes(`${name}@`));
    assert.equal(review.removedInputs.find((entry) => entry.name === name).licenseCleared, false);
  }
  assert.ok(signature.includes('document.registerFontkit'));
  assert.ok(signature.includes('subset: false'));
  assert.ok(
    review.dependencyUseReviewAtBaseline.optionalNodeCanvas.includes('not proof of absence'),
  );
  assert.ok(
    review.dependencyUseReviewAtBaseline.effectOfProjectLicenseChange.includes(
      'four gaps stay open',
    ),
  );
});
