import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { browserTestServer } from './browser-test-server.mjs';
import { browserTestPolicy } from './browser-test-policy.mjs';
import { containsSharpRuntime, reviewedSharpLicense } from './sharp-license-policy.mjs';

const packageJsonPath = new URL('../package.json', import.meta.url);

test('feature-registry contract test cache includes the root scope authority', async () => {
  const turbo = JSON.parse(await readFile(new URL('../turbo.json', import.meta.url), 'utf8'));
  assert.deepEqual(turbo.tasks['@pdfmason/contracts#test'].inputs, [
    '$TURBO_DEFAULT$',
    '$TURBO_ROOT$/docs/product-scope.json',
  ]);
});

test('launch-core browser CI rejects retry-dependent success and persistent failures', async () => {
  assert.deepEqual(browserTestPolicy(''), { failOnFlakyTests: false, retries: 0 });
  assert.deepEqual(browserTestPolicy('true'), { failOnFlakyTests: true, retries: 2 });
  const realConfig = await readFile(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  assert.match(realConfig, /\.\.\.browserTestPolicy\(\)/u);
  assert.doesNotMatch(realConfig, /^\s*(?:failOnFlakyTests|retries):/mu);
  const base = fileURLToPath(new URL('../tmp/browser-gate/', import.meta.url));
  await mkdir(base, { recursive: true });
  const output = await mkdtemp(path.join(base, 'run-'));
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const config = fileURLToPath(
    new URL('./test-fixtures/browser-gate/playwright.config.mjs', import.meta.url),
  );
  for (const [name, expectedExit, flaky, unexpected] of [
    ['clean outcome', 0, 0, 0],
    ['retry-dependent outcome', 1, 1, 0],
    ['persistent failure outcome', 1, 0, 1],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'test',
        '--config',
        config,
        '--grep',
        name,
        '--reporter',
        'json',
        '--output',
        path.join(output, name),
      ],
      {
        env: { ...process.env, CI: 'true' },
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, expectedExit, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.errors.length, 0);
    assert.equal(report.stats.flaky, flaky);
    assert.equal(report.stats.unexpected, unexpected);
    assert.equal(report.stats.expected, expectedExit === 0 ? 1 : 0);
  }
});

test('Next PostCSS uses the reviewed source-map patch and huge offsets finish in a bounded child', () => {
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict';
       import { createRequire } from 'node:module';
       const web = createRequire(${JSON.stringify(new URL('../apps/web/package.json', import.meta.url).href)});
       const next = createRequire(web.resolve('next/package.json'));
       const postcss = createRequire(next.resolve('postcss/package.json'));
       assert.equal(postcss('source-map-js/package.json').version, '1.2.2');
       const { SourceMapConsumer, SourceNode } = postcss('source-map-js');
       const section = {version: 3, sources: ['synthetic.js'], sourcesContent: ['x'], names: [], mappings: 'AAAA'};
       const valid = new SourceMapConsumer({version: 3, sections: [{
         offset: {line: 0, column: 0}, map: section
       }]});
       assert.equal(SourceNode.fromStringWithSourceMap('x', valid).toString(), 'x');
       assert.throws(() => new SourceMapConsumer({version: 3, sections: [{
         offset: {line: 1e12, column: 0}, map: section
       }]}), /Section offset line must not exceed/u);`,
    ],
    { stdio: 'pipe', timeout: 5_000 },
  );
});

test('Sharp license exception accepts only exact reviewed native and libvips packages', () => {
  const native = [{ name: '@img/sharp-win32-x64', versions: ['0.35.5'] }];
  const vips = [{ name: '@img/sharp-libvips-linux-x64', versions: ['1.3.4'] }];
  assert.equal(reviewedSharpLicense('Apache-2.0 AND LGPL-3.0-or-later', native), true);
  assert.equal(reviewedSharpLicense('LGPL-3.0-or-later', vips), true);
  for (const record of [
    { name: '@img/sharp-unknown', versions: ['0.35.5'] },
    { name: 'win32-x64', versions: ['0.35.5'] },
    { name: '@img/sharp-win32-x64', versions: ['0.35.3'] },
    { name: '@img/sharp-win32-x64', versions: ['0.35.5', '0.35.3'] },
  ])
    assert.equal(reviewedSharpLicense('Apache-2.0 AND LGPL-3.0-or-later', [record]), false);
  assert.equal(reviewedSharpLicense('GPL-3.0', native), false);
  assert.equal(reviewedSharpLicense('LGPL-3.0-or-later', native), false);
  assert.equal(reviewedSharpLicense('Apache-2.0 AND LGPL-3.0-or-later', []), false);
});

test('desktop dependency guard detects transitive Sharp, not unrelated canvas packages', () => {
  assert.equal(
    containsSharpRuntime([{ dependencies: { unrelated: { dependencies: { sharp: {} } } } }]),
    true,
  );
  assert.equal(containsSharpRuntime([{ name: '@img/sharp-libvips-linux-x64' }]), true);
  assert.equal(containsSharpRuntime([{ dependencies: { '@napi-rs/canvas': {} } }]), false);
});

test('browser verification owns an isolated server instead of reusing another project', () => {
  assert.deepEqual(browserTestServer(), {
    command:
      'node scripts/check-browser-verifiers.mjs && pnpm build:packages && pnpm --filter @pdfmason/web dev --port 3100',
    env: {
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
      PDFMASON_ALLOWED_ORIGINS: 'http://127.0.0.1:3100',
      PDFMASON_BROWSER_TEST_ISOLATION: '1',
    },
    reuseExistingServer: false,
    url: 'http://127.0.0.1:3100',
  });
  assert.equal(browserTestServer('3101').url, 'http://127.0.0.1:3101');
  assert.equal(browserTestServer('3101').env.PDFMASON_ALLOWED_ORIGINS, 'http://127.0.0.1:3101');
});

test('browser-test port rejects malformed, privileged and out-of-range input', () => {
  for (const port of ['80', '01024', '1023', '65536', '3100 --help', '3100; echo bad', '']) {
    assert.throws(() => browserTestServer(port), /Invalid browser-test port/u);
  }
  assert.equal(browserTestServer('65535').url, 'http://127.0.0.1:65535');
});

test('QA TypeScript inherits strict settings and generated caches stay out of source checks', async () => {
  const load = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const base = JSON.parse(await load('../apps/web/tsconfig.json'));
  const qa = JSON.parse(await load('../apps/web/tsconfig.qa.json'));
  const web = JSON.parse(await load('../apps/web/package.json'));
  assert.equal(qa.extends, './tsconfig.json');
  assert.equal(qa.compilerOptions, undefined);
  assert.ok(base.exclude.includes('.next-qa'));
  assert.ok(qa.exclude.includes('.next'));
  assert.ok(qa.include.includes('.next-qa/dev/types/**/*.ts'));
  assert.equal(web.scripts.typecheck, 'next typegen && tsc --noEmit');
  assert.match(await load('../.gitignore'), /^apps\/web\/next-env\.d\.ts$/mu);
  assert.match(await load('../.prettierignore'), /^\.next-qa$/mu);
  assert.ok((await load('../eslint.config.mjs')).includes('**/.next-qa/**'));
});

test('directory-glob workspace filters are quoted for POSIX shells', async () => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const buildPackages = packageJson.scripts?.['build:packages'];

  assert.equal(typeof buildPackages, 'string');
  assert.match(buildPackages, /--filter ["']\.\/packages\/\*\*["']/u);
});

test('Windows adapter checks build shared exports before typechecking a clean checkout', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/desktop.yml', import.meta.url),
    'utf8',
  );
  const build = workflow.indexOf('run: pnpm build:packages');
  const typecheck = workflow.indexOf('run: pnpm --filter @pdfmason/desktop typecheck');
  const adapterTest = workflow.indexOf('run: pnpm --filter @pdfmason/desktop test');
  assert.ok(build >= 0 && typecheck > build && adapterTest > build);
});

test('CI verifies SEC-001/002/003 outputs and never copies isolated QA caches into workers', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: pnpm test:pdf-permissions/u);
  const ignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');
  assert.match(ignore, /^\*\*\/\.next-qa$/mu);
  assert.match(ignore, /^\*\*\/\*\.tsbuildinfo$/mu);
});

test('active-subscription RLS fixtures use transaction-relative periods, not expired calendar dates', async () => {
  for (const name of [
    '002_cloud_commerce_rls',
    '004_milestone4_operations',
    '005_milestone5_ocr',
  ]) {
    const sql = await readFile(
      new URL(`../packages/db/supabase/tests/database/${name}.test.sql`, import.meta.url),
      'utf8',
    );
    const periods = [
      ...sql.matchAll(/now\(\) - interval '1 day', now\(\) \+ interval '30 days', false/gu),
    ];
    assert.equal(periods.length, name === '002_cloud_commerce_rls' ? 5 : 2);
    assert.doesNotMatch(sql, /'2026-09-01T00:00:00Z'/u);
  }
});

test('billing period repair preserves event ordering and changes only access interval derivation', async () => {
  // Source-shape guard only: pgTAP execution is still required for SQL correctness.
  const load = (name) =>
    readFile(new URL(`../packages/db/supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
  const oldSql = await load('20260821214230_milestone3_cloud_commerce_foundation');
  const newSql = await load('20261004023531_bounded_subscription_entitlement_periods');
  const functionDefinition = (sql, name) => {
    const start = sql.indexOf(`function public.${name}(`);
    assert.ok(start >= 0);
    const end = sql.indexOf('$$;', start);
    assert.ok(end > start);
    return sql
      .slice(start, end + 3)
      .replace(/\s+/gu, ' ')
      .trim();
  };
  const expected = functionDefinition(oldSql, 'accept_stripe_subscription_event')
    .replace(
      "access_enabled := normalized_status in ('active', 'trialing');",
      "access_enabled := normalized_status in ('active', 'trialing') and (period_end is null or period_end > now());",
    )
    .replaceAll(
      "'subscription', now(), period_end, 1",
      "'subscription', least(now(), period_end), period_end, 1",
    );
  assert.equal(functionDefinition(newSql, 'accept_stripe_subscription_event'), expected);

  for (const name of ['refresh_office_conversion_entitlement', 'refresh_ocr_entitlement']) {
    const body = functionDefinition(newSql, name);
    assert.ok(body.includes("security invoker set search_path = ''"));
    assert.ok(body.includes('select * into strict configured from public.plan_feature_defaults'));
    assert.ok(body.includes('configured.limit_value, configured.limit_unit'));
    assert.ok(body.includes('new.current_period_end is null or new.current_period_end > now()'));
    assert.ok(body.includes('least(now(), new.current_period_end)'));
    assert.doesNotMatch(body, /access_enabled, 20/u);
  }
  assert.doesNotMatch(newSql, /alter table|drop constraint|security definer/iu);
  assert.match(newSql, /on conflict \(plan_key, feature_key\) do nothing;/u);
  assert.equal((newSql.match(/from public, anon, authenticated;/gu) ?? []).length, 3);
});

test('cloud hardening migrations keep invoker boundaries and only intended replacements', async () => {
  const load = (name) =>
    readFile(new URL(`../packages/db/supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
  const names = [
    '20261005002010_authorize_cloud_job_replay',
    '20261005002057_bind_cloud_job_request_identity',
    '20261005002246_validate_cloud_reservation_boundary',
    '20261005002452_release_deleted_job_reservations',
  ];
  for (const name of names) {
    const sql = await load(name);
    assert.equal((sql.match(/create or replace function public\./gu) ?? []).length, 1);
    assert.equal((sql.match(/\bas \$\$/gu) ?? []).length, 1);
    assert.equal((sql.match(/\$\$;/gu) ?? []).length, 1);
    assert.match(sql, /security invoker\s+set search_path = ''/u);
    assert.match(sql, /from public, anon, authenticated;/u);
    assert.doesNotMatch(
      sql,
      /security definer|alter table|create function public\.record_operation_cost_metrics/iu,
    );
  }
  const sql = await load(names[2]);
  const validate = sql.indexOf("message = 'INVALID_JOB_RESERVATION'");
  const authorize = sql.indexOf("message = 'WORKSPACE_ACCESS_DENIED'");
  const lock = sql.indexOf('pg_catalog.pg_advisory_xact_lock');
  const lookup = sql.indexOf('select id into existing_job_id');
  const conflict = sql.indexOf("message = 'IDEMPOTENCY_CONFLICT'");
  const replay = sql.indexOf('return existing_job_id;');
  const quota = sql.indexOf('select enabled, limit_value, limit_unit');
  assert.ok(validate >= 0 && authorize > validate && lock > authorize && lookup > lock);
  assert.ok(conflict > lookup && replay > conflict && quota > replay);
  assert.ok(sql.includes(String.raw`job_operation !~ '^[a-z][a-z0-9]*(\.[a-z0-9]+)*$'`));
  assert.ok(sql.includes(String.raw`usage_period_key !~ '^\d{4}-(0[1-9]|1[0-2])$'`));
  assert.ok(sql.includes('jsonb_each(') && sql.includes('jsonb_array_elements('));
  assert.ok(sql.includes('parent.depth < 16') && sql.includes('count(*) > 1024'));
  const deletion = await load(names[3]);
  assert.match(
    deletion,
    /update public\.usage_ledger[\s\S]+workspace_id = target_workspace_id[\s\S]+status = 'reserved'/u,
  );
  // Source shape only; actual role-level pgTAP and advisors must execute in CI.
});

test('reservation race repair preserves grants and puts authorization barriers before lookup', async () => {
  const sql = await readFile(
    new URL(
      '../packages/db/supabase/migrations/20261005015620_serialize_reservation_authorization.sql',
      import.meta.url,
    ),
    'utf8',
  );
  assert.equal((sql.match(/security invoker\s+set search_path = ''/gu) ?? []).length, 3);
  assert.doesNotMatch(sql, /grant (?:update|select|insert|delete)|security definer/iu);
  assert.match(sql, /before update of status, role, workspace_id, user_id or delete/u);
  assert.match(sql, /identities\(key\) order by key/u);
  const reserve = sql.slice(
    sql.indexOf('create or replace function public.create_cloud_job_with_reservation'),
  );
  const workspaceLock = reserve.indexOf('for share of w;');
  const memberLock = reserve.indexOf('pg_advisory_xact_lock_shared');
  const authorize = reserve.indexOf('if not exists');
  const lookup = reserve.indexOf('select id into existing_job_id');
  assert.ok(
    workspaceLock >= 0 &&
      memberLock > workspaceLock &&
      authorize > memberLock &&
      lookup > authorize,
  );
  const deletion = sql.slice(
    sql.indexOf('create or replace function public.request_account_deletion'),
  );
  assert.ok(deletion.indexOf('for update of w;') < deletion.indexOf('update public.profiles'));
  assert.equal((sql.match(/TRANSACTION_ISOLATION_UNSUPPORTED/gu) ?? []).length, 2);
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(
    workflow.indexOf('run: pnpm test:db-concurrency') > workflow.indexOf('run: pnpm db:test'),
  );
  assert.ok(
    workflow.indexOf('run: pnpm db:advisors') > workflow.indexOf('run: pnpm test:db-concurrency'),
  );
});
