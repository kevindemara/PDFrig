import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryFiles, repositoryRoot } from './repository-files.mjs';
import { publicationPathIssues } from './repository-hygiene-policy.mjs';

const load = async (file) => JSON.parse(await readFile(path.join(repositoryRoot, file), 'utf8'));
const approved = new Map();
const failures = [];
function approve(file, hash) {
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error('INVALID_ASSET_PROVENANCE');
  if (publicationPathIssues(file, new Set([file])).length > 0)
    throw new Error('INVALID_ASSET_PATH');
  approved.set(file, hash);
}
for (const [directory, manifest] of [
  ['packages/test-corpus/fixtures', await load('packages/test-corpus/fixtures/manifest.json')],
  [
    'packages/test-corpus/fixtures/images',
    await load('packages/test-corpus/fixtures/images/manifest.json'),
  ],
]) {
  for (const fixture of manifest.fixtures) {
    if (fixture.sensitivity !== 'none' || fixture.license !== 'CC0-1.0')
      throw new Error('UNREVIEWED_FIXTURE_PROVENANCE');
    approve(`${directory}/${fixture.filename}`, fixture.sha256);
  }
}
const scan = await load('packages/test-corpus/fixtures/sources/scanned-ocr.manifest.json');
if (scan.sensitivity !== 'none' || scan.license !== 'CC0-1.0')
  throw new Error('UNREVIEWED_SCAN_PROVENANCE');
approve('packages/test-corpus/fixtures/sources/scanned-ocr.png', scan.sha256);
const office = await load('apps/worker/test-fixtures/manifest.json');
if (office.sensitivity !== 'none') throw new Error('UNREVIEWED_OFFICE_PROVENANCE');
for (const fixture of office.fixtures)
  approve(`apps/worker/test-fixtures/${fixture.filename}`, fixture.sha256);
const brand = await load('docs/brand/pdfrig-export-manifest.json');
for (const asset of brand.exports) approve(asset.path, asset.sha256);
// Source wordmark is retained verbatim and already checked against both exports.
approve(
  brand.source.logo,
  brand.exports.find((asset) => asset.path.endsWith('/pdfrig-logo.png')).sha256,
);
const screenshots = await load('docs/screenshots/manifest.json');
if (
  screenshots.customerDocumentsIncluded !== false ||
  screenshots.sourceCorpusLicense !== 'CC0-1.0'
)
  throw new Error('UNREVIEWED_SCREENSHOT_PROVENANCE');
for (const asset of screenshots.images) approve(`docs/screenshots/${asset.filename}`, asset.sha256);

const files = await repositoryFiles();
const approvedPaths = new Set(approved.keys());
for (const file of files) {
  for (const code of publicationPathIssues(file.relative, approvedPaths))
    failures.push(`${file.relative}: ${code}`);
  const expected = approved.get(file.relative);
  if (
    expected &&
    createHash('sha256')
      .update(await readFile(file.absolute))
      .digest('hex') !== expected
  )
    failures.push(`${file.relative}: ASSET_PROVENANCE_HASH_MISMATCH`);
}
for (const file of approved.keys()) {
  if (!files.some((entry) => entry.relative === file))
    failures.push(`${file}: MISSING_APPROVED_ASSET`);
}
if (failures.length) throw new Error(`Repository hygiene failed:\n${failures.join('\n')}`);
console.log(
  `Repository hygiene passed: ${files.length} files, root README only; assets match reviewed manifests. Git history is separate.`,
);
