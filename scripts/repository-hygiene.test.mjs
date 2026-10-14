import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { publicationPathIssues, sensitiveContentIssues } from './repository-hygiene-policy.mjs';

test('read-only history audit handles a fresh repo and detects removed secrets without disclosing them', async () => {
  const base = path.resolve(fileURLToPath(new URL('../tmp/history-audit/', import.meta.url)));
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'synthetic-'));
  const execute = (args) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true });
  const inspect = () =>
    execFileSync(process.execPath, ['scripts/audit-repository-history.mjs'], {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
    });
  try {
    await mkdir(path.join(directory, 'scripts'));
    for (const filename of [
      'audit-repository-history.mjs',
      'repository-files.mjs',
      'repository-hygiene-policy.mjs',
    ])
      await copyFile(
        new URL(`./${filename}`, import.meta.url),
        path.join(directory, 'scripts', filename),
      );
    execute(['init', '-b', 'main']);
    execute(['config', 'user.name', 'Synthetic QA']);
    execute(['config', 'user.email', 'synthetic@example.invalid']);
    execute(['config', 'commit.gpgsign', 'false']);
    const empty = JSON.parse(inspect());
    assert.equal(empty.objects, 0);
    assert.equal(empty.historyRewritten, false);
    assert.deepEqual(empty.contentFindings, {});
    const canary = 'gh' + 'p_' + 'a'.repeat(40);
    await writeFile(path.join(directory, '.env.test'), canary);
    execute(['add', '--', '.env.test']);
    execute(['commit', '-m', 'Synthetic credential canary']);
    execute(['rm', '--', '.env.test']);
    execute(['commit', '-m', 'Remove synthetic credential canary']);
    const before = execute(['rev-parse', 'HEAD']);
    const output = inspect();
    const historical = JSON.parse(output);
    assert.equal(historical.contentFindings.GITHUB_TOKEN, 1);
    assert.equal(historical.pathFindings.PRIVATE_OR_RELEASE_ARTIFACT, 1);
    assert.equal(historical.unscannedBlobs, 0);
    assert.ok(!output.includes(canary));
    assert.ok(!output.includes('synthetic@example.invalid'));
    assert.equal(execute(['rev-parse', 'HEAD']), before);
  } finally {
    assert.ok(directory.startsWith(base + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test('publication rejects non-root Markdown, private caches, keys and release artifacts', () => {
  for (const path of [
    'AGENTS.md',
    'docs/README.md',
    'notes.MD',
    'notes.markdown',
    'page.mdx',
    '.env',
    '.env.production',
    'apps/web/.env.example',
    'output/concept.png',
    '.tooling/package/index.js',
    'apps/web/.next/server.js',
    'credentials.json',
    'id_ed25519',
    'installer.exe',
    'release.zip',
    'backup.sqlite',
    'private.pem',
    'apps/web/next-env.d.ts',
    'apps/desktop/src-tauri/target/build.json',
    '../outside.txt',
  ])
    assert.ok(publicationPathIssues(path).length > 0, path);
  for (const path of [
    'README.md',
    '.env.example',
    'pnpm-lock.yaml',
    'apps/web/app/page.tsx',
    'docs/dependencies/DancingScript-OFL.txt',
    'docs/operations/handbook.txt',
  ])
    assert.deepEqual(publicationPathIssues(path), [], path);
});

test('documents and bitmap assets require exact registered provenance paths', () => {
  const approved = new Set(['packages/test-corpus/fixtures/smoke-one-page.pdf']);
  assert.deepEqual(publicationPathIssues([...approved][0], approved), []);
  for (const path of [
    'customer.pdf',
    'docs/screenshot.png',
    'personal.docx',
    'packages/test-corpus/fixtures/unregistered.pdf',
    'report.xlsx',
  ])
    assert.ok(publicationPathIssues(path, approved).includes('UNREVIEWED_DOCUMENT_OR_ASSET'));
});

test('content scanning recognizes key/token classes without returning matching values', () => {
  const cases = [
    ['PRIVATE_KEY', '-----BEGIN ' + 'ENCRYPTED PRIVATE KEY-----'],
    ['AWS_ACCESS_KEY', 'AK' + 'IA' + 'A'.repeat(16)],
    ['GITHUB_TOKEN', 'github_' + 'pat_' + 'a'.repeat(70)],
    ['GITHUB_TOKEN', 'gh' + 'p_' + 'a'.repeat(40)],
    ['STRIPE_SECRET', 'sk_' + 'test_' + 'a'.repeat(24)],
    ['STRIPE_SECRET', 'rk_' + 'live_' + 'a'.repeat(24)],
    ['STRIPE_WEBHOOK_SECRET', 'wh' + 'sec_' + 'a'.repeat(32)],
    ['SUPABASE_SECRET', 'sb_' + 'secret_' + 'a'.repeat(24)],
    ['JWT', 'ey' + 'J' + 'a'.repeat(20) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(20)],
    ['PERSONAL_WINDOWS_PATH', 'C:' + '/Users/' + 'example-private-owner/Documents/report.pdf'],
  ];
  for (const [code, value] of cases) {
    assert.deepEqual(sensitiveContentIssues(value), [code]);
    assert.ok(!JSON.stringify(sensitiveContentIssues(value)).includes(value));
  }
  assert.deepEqual(sensitiveContentIssues('NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000'), []);
});

test('public README keeps setup/Windows/launch guidance and agent files are not regenerated', async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const readme = await read('README.md');
  for (const heading of [
    '## Quick start',
    '### Self-hosting',
    '## Windows',
    '### Upgrade and uninstall',
    '### Contributor safety rules',
    '### Publication hygiene',
  ])
    assert.ok(readme.includes(heading));
  assert.match(await read('apps/web/next.config.ts'), /agentRules: false/u);
  assert.match(await read('.github/workflows/ci.yml'), /run: pnpm repo:check/u);
  assert.match(await read('scripts/build-internal-windows.mjs'), /THIRD_PARTY_NOTICES\.txt/u);
});
