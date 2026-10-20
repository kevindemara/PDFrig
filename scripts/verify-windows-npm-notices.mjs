// Offline by default. --registry additionally compares the exact published archive.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boundedRegistryFetch,
  installedNpmEvidence,
  npmTreeEvidence,
  publishedNpmEvidence,
} from './npm-notice-evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.argv.slice(2).every((arg) => arg === '--registry'));
const registry = process.argv.includes('--registry');
const review = JSON.parse(
  await readFile(path.join(root, 'docs/dependencies/windows-npm-notice-review.json'), 'utf8'),
);
assert.equal(review.schemaVersion, 1);
assert.equal(review.publicReleaseApproved, false);
assert.equal(review.allNoticesComplete, false);
const expected = ['@napi-rs/canvas-win32-x64-msvc@1.0.7'];
assert.deepEqual(
  review.packages.map((entry) => `${entry.name}@${entry.version}`),
  expected,
);
for (const entry of review.packages) {
  assert.equal(entry.noticeComplete, false);
  const directory = path.join(
    root,
    'node_modules/.pnpm',
    `${entry.name.replace('/', '+')}@${entry.version}`,
    'node_modules',
    entry.name,
  );
  const files = await installedNpmEvidence(directory);
  assert.deepEqual(npmTreeEvidence(files), entry.tree);
  assert.equal(files.get('package.json')?.sha256, entry.manifestSha256);
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, entry.name);
  assert.equal(manifest.version, entry.version);
  if (registry) {
    const metadata = JSON.parse(
      await boundedRegistryFetch(
        `https://registry.npmjs.org/${encodeURIComponent(entry.name)}/${entry.version}`,
        128 * 1024,
      ),
    );
    assert.equal(metadata.name, entry.name);
    assert.equal(metadata.version, entry.version);
    assert.equal(metadata.gitHead ?? null, entry.gitHead);
    assert.equal(metadata.dist.integrity, entry.integrity);
    assert.equal(metadata.dist.tarball, entry.tarball);
    const archive = await boundedRegistryFetch(entry.tarball, 40 * 1024 * 1024);
    assert.equal(createHash('sha256').update(archive).digest('hex'), entry.archiveSha256);
    assert.deepEqual(npmTreeEvidence(publishedNpmEvidence(archive, entry.integrity)), entry.tree);
  }
}
console.log(
  `One Windows npm payload binding passed (${registry ? 'registry + installed' : 'offline installed'}). One conservative notice gap remains; no legal/native clearance.`,
);
const lock = await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
const engine = JSON.parse(
  await readFile(path.join(root, 'packages/pdf-engine/package.json'), 'utf8'),
);
for (const name of ['fontkit', 'dfa', 'brotli']) {
  assert.ok(!lock.includes(`${name}@`), `${name} must stay absent from the lock`);
  assert.equal(engine.dependencies[name], undefined);
  assert.equal(review.removedInputs.find((entry) => entry.name === name)?.licenseCleared, false);
}
console.log(
  'Fontkit/dfa/Brotli removed from the current graph, not retroactively licensed. Older installers require their own audit.',
);
