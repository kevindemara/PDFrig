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
  assert.ok(readme.includes('owner reports a successful installed-app text edit and export'));
  assert.ok(readme.includes('Windows **Installed apps**'));
  assert.ok(readme.includes('No credentials or paid services are needed'));
  assert.ok(readme.includes('do not disable Application Control'));
  assert.ok(readme.includes('Self-hosting a production service is **not yet'));
  assert.equal(qa.publicReleaseApproved, false);
  assert.equal(qa.installerProduced, false);
  assert.equal(qa.installedAppTested, false);
  assert.equal(qa.buildResult, 'blocked-by-Windows-Application-Control');
});

test('Windows download routes put finished-app installation before optional source builds', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const installHeading = '### Install the finished Windows app';
  const buildHeading = '### Build from source';
  const installStart = readme.indexOf(installHeading);
  const buildStart = readme.indexOf(buildHeading);
  assert.ok(installStart >= 0 && buildStart > installStart);
  assert.ok(readme.includes('](#install-the-finished-windows-app)'));
  assert.ok(readme.includes('](#build-from-source)'));
  assert.ok(readme.includes('[BUILD_WITH_AI.txt](BUILD_WITH_AI.txt)'));
  const installation = readme.slice(installStart, buildStart);
  assert.match(installation, /https:\/\/github\.com\/kevindemara\/PDFrig\/releases/u);
  assert.ok(installation.includes('no supported public installer is published yet'));
  assert.ok(installation.includes('Source code (zip)'));
  assert.ok(installation.includes('Source code (tar.gz)'));
  assert.match(installation, /not need Node\.js, pnpm, Rust, C\+\+ Build\s+Tools/u);
  assert.ok(installation.includes('no Windows installer EXE is included'));
  assert.ok(installation.includes('Stop if installation or execution is blocked'));
  assert.doesNotMatch(installation, /^pnpm |^cargo /mu);
  const source = readme.slice(buildStart, readme.indexOf('### Internal installer testing'));
  assert.ok(source.includes('source ZIPs lack Git metadata'));
  assert.ok(source.includes('internal QA'));
  assert.ok(source.includes('pnpm desktop:dev'));
  assert.ok(source.includes('it does not install PDFrig'));
  assert.ok(source.includes('Purpose of BUILD_WITH_AI.txt'));
  assert.ok(source.includes('not an executable, automatic installer or AI feature'));
  assert.ok(source.includes('Users downloading a finished installer do not need this file'));
  assert.ok(source.includes('exact source commit and archive checksum'));
  assert.ok(source.includes('do not change its checkout'));
  assert.ok(source.includes('GitHub Release asset, not a source commit'));
  assert.ok(source.includes('A successful build alone is not public-release approval'));
});

test('tool-neutral build prompt tracks pinned tools, real commands and review records', async () => {
  const load = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const guide = await load('BUILD_WITH_AI.txt');
  const pkg = JSON.parse(await load('package.json'));
  const nodeVersion = (await load('.nvmrc')).trim();
  const rustVersion = (await load('rust-toolchain.toml')).match(/^channel = "([^"]+)"$/mu)[1];
  for (const pin of [
    `Node ${nodeVersion}`,
    `pnpm ${pkg.packageManager.replace('pnpm@', '')}`,
    `Rust ${rustVersion}`,
  ])
    assert.ok(guide.includes(pin), `Outdated build-guide pin: ${pin}`);
  const [introduction, body] = guide.split('BEGIN BUILD PROMPT');
  assert.ok(body.endsWith('END BUILD PROMPT\n'));
  assert.ok(introduction.includes('A source ZIP lacks Git metadata'));
  assert.ok(introduction.includes('any coding assistant'));
  assert.ok(introduction.includes("Your chosen assistant's own access/usage terms are separate"));
  const commands = [...body.matchAll(/^ {2}((?:pnpm|cargo) .+)$/gmu)].map((match) => match[1]);
  const manifest = 'apps/desktop/src-tauri/Cargo.toml';
  assert.deepEqual(commands, [
    'pnpm install --frozen-lockfile',
    'pnpm check',
    `cargo fetch --locked --manifest-path ${manifest}`,
    `cargo fmt --manifest-path ${manifest} --check`,
    `cargo clippy --locked --offline --manifest-path ${manifest} --all-targets -- -D warnings`,
    `cargo test --locked --offline --manifest-path ${manifest}`,
    'pnpm desktop:notices',
    'pnpm desktop:internal-build --installer-qa',
  ]);
  for (const command of commands.filter((command) => command.startsWith('pnpm '))) {
    const alias = command.split(' ')[1];
    if (alias !== 'install') assert.ok(pkg.scripts[alias], `Missing documented command: ${alias}`);
  }
  const records = [...body.matchAll(/^ {2}(docs\/\S+)$/gmu)].map((match) => match[1]);
  assert.equal(records.length, 4);
  for (const file of [manifest, ...records, 'scripts/build-internal-windows.mjs'])
    await access(new URL(`../${file}`, import.meta.url));
  const helper = await load('scripts/build-internal-windows.mjs');
  assert.ok(helper.includes('internalWindowsProfile(process.argv.slice(2))'));
  assert.ok(
    (await load('scripts/internal-windows-profile.mjs')).includes(
      "args.includes('--installer-qa')",
    ),
  );
  assert.ok(body.includes('SHA256SUMS.txt'));
  assert.ok(body.includes('Get-AuthenticodeSignature'));
  assert.ok(body.includes('updater-signature verification'));
});

test('AI build instructions retain approval gates instead of treating a build as release clearance', async () => {
  const guide = await readFile(new URL('../BUILD_WITH_AI.txt', import.meta.url), 'utf8');
  for (const boundary of [
    'No supported public installer is available yet',
    'This file grants no license',
    'ask before installing or changing tools',
    'check $LASTEXITCODE immediately',
    'propose a\nminimal repair for my approval',
    'partial installer/checksum output is not a successful build',
    'Ask before installing/uninstalling',
    'Stop at Windows Application Control',
    'No purchases, paid certificates/services, billing changes, hosted CI jobs',
    'NOT license clearance',
    'unchanged visible\nscans',
    'independent export/preview comparison',
    'Do not commit installers, caches or tools',
  ])
    assert.ok(guide.includes(boundary), `Missing safety boundary: ${boundary}`);
  assert.doesNotMatch(
    guide,
    /--ignore-scripts|--no-verify|--dangerously|--skip|ExecutionPolicy Bypass/iu,
  );
});

test('Windows export repair records local build success without claiming installed-app or security clearance', async () => {
  const load = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const review = JSON.parse(await load('docs/operations/windows-export-review.json'));
  assert.equal(review.publicReleaseApproved, false);
  assert.equal(review.currentHost.securitySettingsChangedByThisWork, false);
  assert.equal(review.currentHost.nativeTestsPassedUnderNormalCurrentPolicy, true);
  assert.equal(review.qaBuild.status, 'passed-local-internal-build');
  assert.equal(review.qaBuild.installerProduced, true);
  assert.equal(review.qaBuild.installedAppTested, false);
  assert.equal(review.qaBuild.published, false);
  assert.equal(review.qaBuild.authenticode, 'NotSigned');
  assert.equal(review.qaBuild.ephemeralPrivateKeyCleanupConfirmed, true);
  assert.match(review.fixSourceCommit, /^[a-f0-9]{40}$/u);
  assert.match(review.qaBuild.installerSha256, /^[a-f0-9]{64}$/u);
  const profiles = await load('scripts/internal-windows-profile.mjs');
  assert.ok(profiles.includes(review.qaBuild.version));
  assert.ok(profiles.includes(review.qaBuild.buildDirectory.split('/').at(-1)));
  assert.equal(review.tests.pinnedRealTransportRegressionTests, 9);
  assert.ok(review.remainingGates.some((gate) => gate.includes('installed-app')));
  assert.ok(review.remainingGates.some((gate) => gate.includes('licensing')));
});

test('branded private build records artifact identity without claiming Windows or license clearance', async () => {
  const review = JSON.parse(
    await readFile(
      new URL('../docs/operations/windows-branded-build.json', import.meta.url),
      'utf8',
    ),
  );
  const { internalWindowsProfile } = await import('./internal-windows-profile.mjs');
  const profile = internalWindowsProfile(['--private-test']);
  assert.equal(review.version, profile.version);
  assert.equal(review.identifier, profile.identifier);
  assert.equal(review.buildDirectory.split('/').at(-1), profile.buildId);
  assert.equal(review.publicReleaseApproved, false);
  assert.equal(review.installedAppTested, false);
  assert.equal(review.published, false);
  assert.equal(review.authenticode, 'NotSigned');
  assert.equal(review.securitySettingsChangedByThisWork, false);
  assert.equal(review.ephemeralPrivateKeyCleanupConfirmed, true);
  assert.equal(review.notices.distributionClearance, false);
  assert.equal(review.developerCredit.url, 'https://github.com/kevindemara');
  assert.equal(review.observedBuildMetadata.generatedShortcutName, 'PDFrig.lnk');
  assert.match(review.sourceCommit, /^[a-f0-9]{40}$/u);
  assert.match(review.installerSha256, /^[a-f0-9]{64}$/u);
  assert.equal(review.installerFilename, `PDFrig_${profile.version}_x64-setup.exe`);
  assert.ok(review.remainingGates.some((gate) => gate.includes('licensing')));
});

test('notice review accounts for every remaining group without treating texts as legal clearance', async () => {
  const load = async (file) =>
    JSON.parse(await readFile(new URL(`../docs/${file}`, import.meta.url), 'utf8'));
  const review = await load('dependencies/desktop-notice-review.json');
  const supplements = await load('dependencies/desktop-license-supplements.json');
  const qa = await load('operations/windows-installer-qa.json');
  assert.equal(review.publicReleaseApproved, false);
  assert.equal(review.remainingTextGaps, 28);
  assert.equal(review.declaredInputCount, qa.noticeAudit.declaredInputCount);
  assert.equal(review.remainingTextGaps, qa.noticeAudit.remainingTextGaps);
  assert.equal(
    review.windowsTargetMetadata.remainingCandidateGaps,
    qa.noticeAudit.windowsCandidateGaps,
  );
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
