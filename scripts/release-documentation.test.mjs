import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('VIEW-001 release README links resolve and do not claim unfinished editor capabilities', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('development preview, not a public release'));
  assert.ok(readme.includes('Text → OCR this page'));
  assert.ok(readme.includes('Edit existing text'));
  assert.ok(readme.includes('printable ASCII only'));
  assert.ok(readme.includes('not visibly editable'));
  assert.ok(readme.includes('Code → Download ZIP is source code'));
  assert.ok(readme.includes('No paid code-signing certificate'));
  assert.ok(readme.includes('source-available'));
  assert.ok(readme.includes('UNLICENSED'));
  for (const match of readme.matchAll(/\]\(([^)]+)\)/gu)) {
    const target = match[1].split('#')[0];
    if (target === '' || /^https?:\/\//u.test(target)) continue;
    await access(new URL(`../${target}`, import.meta.url));
  }
});

test('VIEW-001 screenshot integrity and safe fixed-corpus provenance are retained', async () => {
  const directory = new URL('../docs/screenshots/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  assert.equal(manifest.customerDocumentsIncluded, false);
  assert.equal(manifest.sourceCorpusLicense, 'CC0-1.0');
  assert.equal(manifest.sourceFixture, 'packages/test-corpus/fixtures/tagged-bookmarks.pdf');
  assert.deepEqual(
    manifest.images.map((image) => image.filename),
    ['workspace.png', 'local-tools.png'],
  );
  for (const entry of manifest.images) {
    const bytes = await readFile(new URL(entry.filename, directory));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), entry.width);
    assert.equal(bytes.readUInt32BE(20), entry.height);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
});

test('Windows setup instructions distinguish development, future installer and unverified compliance', async () => {
  const load = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const readme = await load('README.md');
  const scripts = JSON.parse(await load('package.json')).scripts;
  const qa = JSON.parse(await load('docs/operations/windows-installer-qa.json'));
  for (const command of ['web:dev', 'desktop:dev', 'desktop:notices', 'desktop:internal-build']) {
    assert.ok(scripts[command]);
    assert.ok(readme.includes(`pnpm ${command}`));
  }
  assert.ok(readme.includes('Desktop development with C++'));
  assert.ok(readme.includes('x86_64-pc-windows-msvc'));
  assert.ok(readme.includes('it does not install PDFrig'));
  assert.ok(readme.includes('Windows compliance is not certified'));
  assert.ok(readme.includes('No current-source installer'));
  assert.ok(readme.includes('Windows **Installed apps**'));
  assert.ok(readme.includes('No credentials or paid services are needed'));
  assert.ok(readme.includes('do not disable Application Control'));
  assert.ok(readme.includes('Self-hosting a production service is **not yet'));
  assert.equal(qa.publicReleaseApproved, false);
  assert.equal(qa.installerProduced, false);
  assert.equal(qa.installedAppTested, false);
  assert.equal(qa.buildResult, 'blocked-by-Windows-Application-Control');
});

test('notice review accounts for every remaining group without treating texts as legal clearance', async () => {
  const load = async (file) =>
    JSON.parse(await readFile(new URL(`../docs/${file}`, import.meta.url), 'utf8'));
  const review = await load('dependencies/desktop-notice-review.json');
  const supplements = await load('dependencies/desktop-license-supplements.json');
  const qa = await load('operations/windows-installer-qa.json');
  assert.equal(review.publicReleaseApproved, false);
  assert.equal(review.remainingTextGaps, 32);
  assert.equal(review.declaredInputCount, qa.noticeAudit.declaredInputCount);
  assert.equal(review.remainingTextGaps, qa.noticeAudit.remainingTextGaps);
  assert.equal(review.resolvedSupplementCount, supplements.packages.length);
  assert.equal(qa.noticeAudit.resolvedExactSourceTexts.length, supplements.packages.length);
  const packages = review.remainingGroups.flatMap((group) => group.packages);
  assert.equal(new Set(packages).size, review.remainingTextGaps);
  assert.equal(packages.length, review.remainingTextGaps);
  const resolved = new Set(supplements.packages.map((pkg) => `${pkg.name}@${pkg.version}`));
  assert.ok(packages.every((pkg) => !resolved.has(pkg)));
  assert.ok(review.remainingGroups.every((group) => group.nextAction.length > 20));
  assert.equal(qa.noticeAudit.nativeBuildAttempted, false);
});
