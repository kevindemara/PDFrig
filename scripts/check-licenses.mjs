import { execFileSync } from 'node:child_process';
import { containsSharpRuntime, reviewedSharpLicense } from './sharp-license-policy.mjs';

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) {
  throw new Error('pnpm CLI path is unavailable; run this check through `pnpm license:check`.');
}
const output = execFileSync(process.execPath, [pnpmCli, 'licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const report = JSON.parse(output);

const acceptedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'Apache-2.0 OR MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  '(MIT AND Zlib)',
]);
const desktopGraph = JSON.parse(
  execFileSync(
    process.execPath,
    [
      pnpmCli,
      '--filter',
      '@pdfmason/desktop...',
      'list',
      '--prod',
      '--depth',
      'Infinity',
      '--json',
    ],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  ),
);
if (containsSharpRuntime(desktopGraph))
  throw new Error('Server-only Sharp/libvips must not enter the Windows dependency graph.');
const prohibitedTerms = [
  'AGPL',
  'BUSL',
  'Commons Clause',
  'Elastic License',
  'SSPL',
  'UNLICENSED',
  'UNKNOWN',
];

const licenseGroups = Object.keys(report);
const prohibited = licenseGroups.filter((license) =>
  prohibitedTerms.some((term) => license.toUpperCase().includes(term.toUpperCase())),
);
const reviewRequired = licenseGroups.filter(
  (license) =>
    !acceptedLicenses.has(license) &&
    !prohibited.includes(license) &&
    !reviewedSharpLicense(license, report[license]),
);

if (prohibited.length > 0 || reviewRequired.length > 0) {
  const details = [
    prohibited.length > 0 ? `Prohibited licences: ${prohibited.join(', ')}` : null,
    reviewRequired.length > 0 ? `Licences requiring review: ${reviewRequired.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  throw new Error(`Dependency licence policy failed.\n${details}`);
}

const packageCount = Object.values(report).reduce(
  (count, packages) => count + (Array.isArray(packages) ? packages.length : 0),
  0,
);
process.stdout.write(
  `Dependency licence policy passed for ${packageCount} package records across ${licenseGroups.length} licence groups.\n`,
);
