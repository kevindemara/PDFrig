import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('VIEW-001 release README links resolve and do not claim unfinished editor capabilities', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('development preview, not a public release'));
  assert.ok(readme.includes('there is no editor OCR action yet'));
  assert.ok(readme.includes('not approved or connected to the editor'));
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
