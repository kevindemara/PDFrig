import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { sourceTextEvaluationVerdict } from './source-text-evaluation-policy.mjs';

const pass = {
  caseIndex: 0,
  sourceReplaced: true,
  outsidePixelsEqual: true,
  taggedActualTextConsistent: true,
  textGeometryRetained: true,
  bookmarksRetained: true,
};

test('EDIT-002 technical review does not approve the unbound binary or adopt it into the engine', async () => {
  const review = JSON.parse(
    await readFile(
      new URL('../docs/dependencies/source-text-engine-review.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(review.wrapperLicense, 'MIT');
  assert.equal(review.runtimeApproved, false);
  assert.equal(review.artifactSourceBindingVerified, false);
  assert.equal(review.completeWasmLicenseInventoryVerified, false);
  assert.notEqual(review.sha256.wasm, review.sha256.olderV2150VendorWasm);
  const engine = JSON.parse(
    await readFile(new URL('../packages/pdf-engine/package.json', import.meta.url), 'utf8'),
  );
  assert.equal(engine.dependencies[review.package], undefined);
});

test('EDIT-002 one happy-path candidate is not permission to ship', () => {
  const verdict = sourceTextEvaluationVerdict([pass]);
  assert.equal(verdict.runtimeApproved, false);
  assert.equal(verdict.status, 'research_only');
  assert.ok(verdict.blockers.includes('DEPENDENCY_REVIEW_INCOMPLETE'));
  assert.ok(verdict.blockers.includes('BROAD_FONT_LAYOUT_CORPUS_INCOMPLETE'));
});
test('EDIT-002 stale accessibility text blocks promotion even when pixels match', () => {
  assert.ok(
    sourceTextEvaluationVerdict([{ ...pass, taggedActualTextConsistent: false }]).blockers.includes(
      'ACCESSIBILITY_TEXT_STALE',
    ),
  );
});

test('EDIT-002 font/size/baseline changes block promotion even inside the visual edit mask', () => {
  assert.ok(
    sourceTextEvaluationVerdict([{ ...pass, textGeometryRetained: false }]).blockers.includes(
      'TEXT_GEOMETRY_CHANGED',
    ),
  );
});
test('EDIT-002 changed unrelated pixels/bookmarks and failed replacements remain separate failures', () => {
  const verdict = sourceTextEvaluationVerdict([
    { ...pass, sourceReplaced: false, outsidePixelsEqual: false, bookmarksRetained: false },
  ]);
  for (const code of [
    'SOURCE_REPLACEMENT_FAILED',
    'UNRELATED_RENDERING_CHANGED',
    'BOOKMARKS_CHANGED',
  ])
    assert.ok(verdict.blockers.includes(code));
});
test('EDIT-002 research reports reject malformed, duplicate and content-bearing fields', () => {
  for (const rows of [
    null,
    [],
    [{ ...pass, text: 'private canary' }],
    [pass, pass],
    [{ ...pass, sourceReplaced: 'true' }],
    [{ ...pass, caseIndex: -1 }],
  ])
    assert.throws(
      () => sourceTextEvaluationVerdict(rows),
      /^Error: TEXT_EVALUATION_REPORT_INVALID$/,
    );
});
