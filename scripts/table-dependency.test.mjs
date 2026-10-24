import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
test('CONV-007 binds official export dependency, full notices and no runtime dependencies', async () => {
  const review = JSON.parse(
    await readFile(path.join(root, 'docs/dependencies/table-export-review.json'), 'utf8'),
  );
  assert.equal(review.publicReleaseApproved, false);
  const dependency = review.dependency;
  const require = createRequire(path.join(root, 'packages/pdf-engine/package.json'));
  const directory = path.dirname(require.resolve('xlsx'));
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  assert.equal(metadata.version, '0.20.3');
  assert.equal(metadata.license, 'Apache-2.0');
  assert.deepEqual(metadata.dependencies, {});
  const digest = async (file) =>
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
  assert.equal(await digest(path.join(directory, 'xlsx.mjs')), dependency.esmSha256);
  assert.equal(await digest(path.join(directory, 'index.d.ts')), dependency.typesSha256);
  for (const file of [
    path.join(directory, 'LICENSE'),
    path.join(root, dependency.retainedNotice),
    ...['web', 'desktop'].map((host) =>
      path.join(root, 'apps', host, 'public', dependency.publicNotice),
    ),
  ])
    assert.equal(await digest(file), dependency.licenseSha256);
  const project = JSON.parse(
    await readFile(path.join(root, 'packages/pdf-engine/package.json'), 'utf8'),
  );
  assert.equal(project.dependencies.xlsx, 'workspace:*');
  const lock = await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  assert.ok(lock.includes('version: link:../sheetjs-ce'));
});
