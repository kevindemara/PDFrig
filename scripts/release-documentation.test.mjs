import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

test('approved MIT terms cover current first-party manifests without relicensing upstreams', async () => {
  const load = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const license = (await load('LICENSE')).replaceAll('\r\n', '\n');
  assert.equal(
    createHash('sha256').update(license).digest('hex'),
    '8a753bd1af90dbf9a7756f5e73d372ebac08ec070b7d0033e053336babdc9eb4',
  );
  const manifests = ['package.json'];
  for (const base of ['apps', 'packages'])
    for (const entry of await readdir(new URL(`../${base}/`, import.meta.url), {
      withFileTypes: true,
    }))
      if (entry.isDirectory()) manifests.push(`${base}/${entry.name}/package.json`);
  assert.equal(manifests.length, 12);
  for (const file of manifests) {
    const manifest = JSON.parse(await load(file));
    assert.equal(manifest.license, 'MIT', file);
    assert.equal(manifest.private, true, file); // Not authorization to publish packages.
  }
  assert.match(await load('apps/desktop/src-tauri/Cargo.toml'), /^license = "MIT"$/mu);
  const notices = await load('scripts/prepare-desktop-notices.mjs');
  assert.ok(
    notices.includes(
      "copyFile(path.join(root, 'LICENSE'), path.join(output, 'PDFrig-LICENSE.txt'))",
    ),
  );
  assert.ok(
    (await load('scripts/build-internal-windows.mjs')).includes("'licenses/PDFrig-LICENSE.txt'"),
  );
  const review = JSON.parse(await load('docs/dependencies/desktop-notice-review.json'));
  assert.equal(review.publicReleaseApproved, false);
  assert.equal(review.remainingTextGaps, 25);
});

test('VIEW-001 release README links resolve and do not claim unfinished editor capabilities', async () => {
  const readme = (await readFile(new URL('../README.md', import.meta.url), 'utf8')).replace(
    /\s+/gu,
    ' ',
  );
  assert.ok(readme.includes('Public alpha release'));
  assert.doesNotMatch(readme, /development preview|not a public release/iu);
  assert.ok(readme.includes('Text → OCR this page'));
  assert.ok(readme.includes('Edit existing text'));
  assert.ok(readme.includes('printable ASCII only'));
  assert.ok(readme.includes('not visibly editable'));
  assert.ok(readme.includes('Code → Download ZIP is source code'));
  assert.ok(readme.includes('No paid code-signing certificate'));
  assert.ok(readme.includes('[MIT License](LICENSE)'));
  assert.ok(readme.includes('use, modify, redistribute and sell copies'));
  assert.doesNotMatch(
    readme,
    /source-available|UNLICENSED|selling copies has not been authorized/iu,
  );
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
  const readme = (await load('README.md')).replace(/\s+/gu, ' ');
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
  assert.ok(
    readme.includes('successful installation and use on a second Windows PC has been reported'),
  );
  assert.ok(readme.includes('Windows **Installed apps**'));
  assert.ok(readme.includes('No credentials or paid services are needed'));
  assert.ok(readme.includes('do not disable Application Control'));
  assert.ok(readme.includes('**not yet a supported one-command setup**'));
  assert.equal(qa.publicReleaseApproved, false);
  assert.equal(qa.installerProduced, false);
  assert.equal(qa.installedAppTested, false);
  assert.equal(qa.buildResult, 'blocked-by-Windows-Application-Control');
});

test('Windows download routes put finished-app installation before optional source builds', async () => {
  const rawReadme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const readme = rawReadme.replace(/\s+/gu, ' ');
  const installHeading = '### Install the finished Windows app';
  const buildHeading = '### Build from source';
  const installStart = readme.indexOf(installHeading);
  const buildStart = readme.indexOf(buildHeading);
  assert.ok(installStart >= 0 && buildStart > installStart);
  assert.ok(readme.includes('](#install-the-finished-windows-app)'));
  assert.ok(readme.includes('](#build-from-source)'));
  assert.ok(readme.includes('](BUILD_WITH_AI.txt)'));
  const installation = readme.slice(installStart, buildStart);
  assert.match(installation, /https:\/\/github\.com\/kevindemara\/PDFrig\/releases/u);
  assert.ok(installation.includes('unsigned alpha release'));
  assert.ok(installation.includes('Source code (zip)'));
  assert.ok(installation.includes('Source code (tar.gz)'));
  assert.match(installation, /not need Node\.js, pnpm, Rust, C\+\+ Build Tools/u);
  assert.ok(installation.includes('no Windows installer EXE is included'));
  assert.ok(installation.includes('Stop if installation or execution is blocked'));
  assert.doesNotMatch(installation, /^pnpm |^cargo /mu);
  const source = readme.slice(buildStart, readme.indexOf('### Internal installer testing'));
  assert.ok(source.includes('source ZIPs lack Git metadata'));
  assert.ok(source.includes('internal QA installer'));
  assert.ok(source.includes('pnpm desktop:dev'));
  assert.ok(source.includes('it does not install PDFrig'));
  assert.ok(source.includes('Purpose of BUILD_WITH_AI.txt'));
  assert.ok(source.includes('not an executable, automatic installer or AI feature'));
  assert.ok(source.includes('Users downloading a finished installer do not need this file'));
  assert.ok(source.includes('exact source commit and archive checksum'));
  assert.match(source, /do not change its checkout/iu);
  assert.ok(readme.includes('A successful build alone is not public-release approval'));
  assert.ok(readme.indexOf('## Quick start') < readme.indexOf('## Windows'));
  assert.ok(
    readme.indexOf('pnpm web:dev') < readme.indexOf('### Install the finished Windows app'),
  );
  assert.ok(readme.includes('Free for personal and business use.'));
  assert.doesNotMatch(readme, /The owner(?:'|’)?s|\bStripe\b/iu);
  assert.ok(readme.includes('legacy managed-service, account and billing code'));
  assert.ok(
    rawReadme.includes('```powershell\n' + 'git clone https://github.com/kevindemara/PDFrig.git'),
  );
});

test('publication audit keeps privacy findings separate from source-license and release approval', async () => {
  const audit = JSON.parse(
    await readFile(new URL('../docs/operations/publication-audit.json', import.meta.url), 'utf8'),
  );
  assert.equal(audit.publicReleaseApproved, false);
  assert.equal(audit.repositoryVisibilityChanged, false);
  assert.equal(audit.reachableHistoryAtBaseline.historyRewritten, false);
  assert.equal(audit.reachableHistoryAtBaseline.nonNoreplyAuthorAddresses, 0);
  assert.deepEqual(audit.reachableHistoryAtBaseline.sensitiveContentFindings, {});
  assert.equal(audit.releaseAttachments.obsoleteReleaseRemovedWithUserApproval, true);
  assert.equal(audit.releaseAttachments.obsoleteGitTagPreserved, true);
  assert.equal(audit.releaseAttachments.retainedInstaller, 'PDFrig-setup.exe');
  assert.equal(audit.releaseAttachments.installerInternalsPrivacyCertified, false);
  assert.equal(audit.screenshots.customerDocumentsIncluded, false);
  assert.equal(audit.sourceLicenseFollowup.userApproved, true);
  assert.equal(audit.sourceLicenseFollowup.license, 'MIT');
  assert.equal(audit.sourceLicenseFollowup.redistributionAndCommercialResalePermitted, true);
  assert.equal(audit.sourceLicenseFollowup.historicalBuildRecordsRetainOriginalStatus, true);
  assert.equal(audit.sourceLicenseFollowup.installerRebuiltForLicenseChange, false);
  assert.equal(audit.sourceLicenseFollowup.thirdPartyNoticesClearedByProjectLicense, false);
  assert.ok(audit.remainingPublicationGates.some((gate) => gate.includes('24 other-platform')));
  assert.ok(audit.remainingPublicationGates.some((gate) => gate.includes('native OCR')));
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
    'Windows release is an unsigned\nalpha',
    'prompt does not grant rights to third-party material or waive release gates',
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
  // Historical artifact evidence must not be relabeled when the next build is versioned.
  assert.equal(review.version, '0.1.0-alpha.20261019.4');
  assert.equal(review.identifier, 'com.pdfmason.desktop.privatetest');
  assert.equal(review.buildDirectory.split('/').at(-1), 'private-test-20261019-pdfrig');
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
  assert.equal(review.installerFilename, 'PDFrig-setup.exe');
  assert.equal(review.originalBuildFilename, `PDFrig_${review.version}_x64-setup.exe`);
  assert.ok(review.remainingGates.some((gate) => gate.includes('licensing')));
});

test('private installer download matches the build snapshot without granting public release approval', async () => {
  const load = async (file) =>
    JSON.parse(await readFile(new URL(`../docs/operations/${file}`, import.meta.url), 'utf8'));
  const release = await load('windows-private-release.json');
  const build = await load('windows-branded-build.json');
  assert.equal(release.repository, 'kevindemara/PDFrig');
  assert.equal(release.repositoryPrivateAtUploadAndVerification, true);
  assert.equal(release.publicReleaseApproved, false);
  assert.equal(release.prerelease, true);
  assert.equal(release.draft, false);
  assert.equal(release.installedAppTested, false);
  assert.equal(release.authenticode, 'NotSigned');
  assert.equal(release.downloadedArtifactHashVerified, true);
  assert.equal(release.uploadedChecksumListingVerified, true);
  assert.equal(release.assetName, build.installerFilename);
  assert.equal(release.assetBytes, build.installerBytes);
  assert.equal(release.assetSha256, build.installerSha256);
  assert.equal(release.executableSourceCommit, build.sourceCommit);
  assert.equal(release.version, build.version);
  assert.equal(
    release.downloadUrl,
    `https://github.com/${release.repository}/releases/download/${release.tag}/PDFrig-setup.exe`,
  );
  assert.ok(release.assets.includes('SHA256SUMS.txt'));
  assert.ok(release.assets.includes('windows-branded-build.json'));
  assert.ok(release.assets.every((name) => !name.endsWith('.key')));
});

test('VIEW-001 All tools installer binds the corrected profile and installed smoke evidence without clearing release gates', async () => {
  const build = JSON.parse(
    await readFile(
      new URL('../docs/operations/windows-all-tools-build.json', import.meta.url),
      'utf8',
    ),
  );
  const { internalWindowsProfile } = await import('./internal-windows-profile.mjs');
  const profile = internalWindowsProfile(['--private-test']);
  assert.equal(build.version, '0.1.0-alpha.20261019.6'); // Historical artifact, not the next build profile.
  assert.equal(build.identifier, profile.identifier);
  assert.equal(
    build.buildDirectory.split('/').at(-1),
    'private-test-20261019-all-tools-confirmation',
  );
  assert.equal(build.publicReleaseApproved, false);
  assert.equal(build.published, false);
  assert.equal(build.installedAppTested, true);
  assert.equal(build.authenticode, 'NotSigned');
  assert.equal(build.securitySettingsChangedByThisWork, false);
  assert.equal(build.billingChangedByThisWork, false);
  assert.equal(build.ephemeralPrivateKeyCleanupConfirmed, true);
  assert.equal(build.notices.distributionClearance, false);
  assert.equal(build.notices.unresolvedUpstreamTextGaps, 28);
  assert.equal(build.rejectedPredecessor.uploaded, false);
  assert.equal(build.installerFilename, 'PDFrig-setup.exe');
  assert.equal(build.originalBuildFilename, `PDFrig_${build.version}_x64-setup.exe`);
  assert.match(build.sourceCommit, /^[a-f0-9]{40}$/u);
  assert.match(build.installerSha256, /^[a-f0-9]{64}$/u);
  assert.equal(build.installedSmokeTest.installerExitCode, 0);
  for (const check of [
    'allToolsVisible',
    'unsavedConfirmationShown',
    'cancelPreservesFieldAndUndo',
    'explicitDiscardOpensTools',
    'successfulExportClearsEditWarning',
    'openEditorReturnsToWorkspace',
    'canonicalFieldAndWidgetValuesAgree',
    'widgetAppearanceNonempty',
    'bookmarksAndTagsPresent',
    'outsideEditedFieldPixelsUnchanged',
    'secondPagePixelsUnchanged',
    'sourceFileUnchanged',
  ]) {
    assert.equal(build.installedSmokeTest[check], true, check);
  }
  assert.ok(build.remainingGates.some((gate) => gate.includes('licensing')));
  assert.ok(build.remainingGates.some((gate) => gate.includes('uninstall')));
});

test('VIEW-001 current Windows download matches the verified All tools artifact and README', async () => {
  const load = async (name) =>
    JSON.parse(await readFile(new URL(`../docs/operations/${name}`, import.meta.url), 'utf8'));
  const build = await load('windows-all-tools-build.json');
  const release = await load('windows-all-tools-release.json');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.equal(release.repository, 'kevindemara/PDFrig');
  assert.equal(release.repositoryPrivateAtUploadAndVerification, true);
  assert.equal(release.publicReleaseApproved, false);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, true);
  assert.equal(release.authenticode, 'NotSigned');
  assert.equal(release.installedAppTested, true);
  assert.equal(release.version, build.version);
  assert.equal(release.assetName, build.installerFilename);
  assert.equal(release.assetBytes, build.installerBytes);
  assert.equal(release.assetSha256, build.installerSha256);
  assert.equal(release.executableSourceCommit, build.sourceCommit);
  assert.equal(release.releaseTargetCommit, build.sourceCommit);
  assert.equal(release.githubAssetDigest, `sha256:${build.installerSha256}`);
  for (const key of [
    'downloadedArtifactHashVerified',
    'uploadedChecksumListingVerified',
    'downloadedCompanionHashesVerified',
    'downloadedInstallerSignatureVerifiedWithNegativeCases',
    'publishedTagTargetVerified',
  ])
    assert.equal(release[key], true, key);
  assert.equal(
    release.downloadUrl,
    `https://github.com/${release.repository}/releases/download/${release.tag}/PDFrig-setup.exe`,
  );
  assert.ok(readme.includes(release.downloadUrl));
  assert.ok(readme.includes(release.releaseUrl));
  assert.ok(readme.includes(release.version));
  assert.ok(readme.includes('docs/operations/windows-all-tools-build.json'));
  assert.ok(readme.includes('docs/operations/windows-all-tools-release.json'));
  assert.ok(release.assets.includes('windows-all-tools-build.json'));
  assert.ok(release.assets.includes('SHA256SUMS.txt'));
  assert.ok(release.assets.every((name) => !name.endsWith('.key')));
});

test('notice review accounts for every remaining group without treating texts as legal clearance', async () => {
  const load = async (file) =>
    JSON.parse(await readFile(new URL(`../docs/${file}`, import.meta.url), 'utf8'));
  const review = await load('dependencies/desktop-notice-review.json');
  const supplements = await load('dependencies/desktop-license-supplements.json');
  const qa = await load('operations/windows-installer-qa.json');
  assert.equal(review.publicReleaseApproved, false);
  assert.equal(review.remainingTextGaps, 25);
  assert.equal(review.declaredInputCount, 560);
  assert.equal(review.windowsTargetMetadata.remainingCandidateGaps, 1);
  assert.equal(
    review.previousDeclaredInputSnapshot.declaredInputCount,
    qa.noticeAudit.declaredInputCount,
  );
  assert.equal(
    review.previousDeclaredInputSnapshot.remainingTextGaps,
    qa.noticeAudit.remainingTextGaps,
  );
  assert.equal(
    review.previousDeclaredInputSnapshot.windowsCandidateGaps,
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
