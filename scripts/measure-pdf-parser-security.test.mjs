import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const workspace = resolve(import.meta.dirname, '..');
const harness = resolve(workspace, 'scripts/measure-pdf-parser-security.mjs');

test('isolated parser harness emits a content-free baseline report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pdfmason-parser-harness-test-'));
  try {
    const output = join(directory, 'report.json');
    const result = spawnSync(
      process.execPath,
      [harness, '--case', 'baseline', '--output', output],
      {
        cwd: workspace,
        encoding: 'utf8',
        shell: false,
        timeout: 30_000,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(report.featureIds, ['OPT-001', 'SEC-006']);
    assert.equal(
      report.harnessSafetyCaps.classification,
      'measurement-process-only-not-product-limits',
    );
    assert.equal(report.measurements.length, 1);
    assert.equal(report.measurements[0].caseId, 'baseline');
    assert.equal(report.measurements[0].decodedBytes, 0);
    assert.equal(report.measurements[0].outcome, 'success');
    assert.match(report.measurements[0].inputSha256, /^[a-f0-9]{64}$/u);
    assert.ok(report.measurements[0].elapsedMs >= 0);
    assert.ok(report.measurements[0].maxRssBytes > 0);
    assert.equal(JSON.stringify(report).includes(workspace), false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('isolated parser harness rejects unknown case identifiers safely', () => {
  const result = spawnSync(process.execPath, [harness, '--case', 'unknown'], {
    cwd: workspace,
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Unknown synthetic parser case\.\s*$/u);
  assert.equal(result.stdout, '');
});
