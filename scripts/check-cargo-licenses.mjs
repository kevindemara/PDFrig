import { execFileSync } from 'node:child_process';

const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--locked',
      '--format-version',
      '1',
      '--manifest-path',
      'apps/desktop/src-tauri/Cargo.toml',
    ],
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  ),
);

const workspaceMembers = new Set(metadata.workspace_members);
const thirdParty = metadata.packages.filter(({ id }) => !workspaceMembers.has(id));
const unknown = thirdParty.filter(
  ({ license, license_file: licenseFile }) => !license && !licenseFile,
);
const alwaysProhibited =
  /AGPL|SSPL|BUSL|Elastic[- ]License|Commons[- ]Clause|PolyForm|Prosperity|Non[- ]Commercial/i;
const copyleft = /(?:^|[^A])(?:GPL|LGPL)-/i;
const permissiveAlternative = /MIT|Apache|BSD|ISC|Zlib|0BSD/i;
const prohibited = thirdParty.filter(
  ({ license = '' }) =>
    alwaysProhibited.test(license) ||
    (copyleft.test(license) && !permissiveAlternative.test(license)),
);

if (unknown.length > 0 || prohibited.length > 0) {
  const format = ({ name, version, license }) => `${name}@${version} (${license ?? 'unknown'})`;
  const details = [
    unknown.length > 0 ? `Unknown licences: ${unknown.map(format).join(', ')}` : null,
    prohibited.length > 0 ? `Prohibited licences: ${prohibited.map(format).join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  throw new Error(`Cargo dependency licence policy failed.\n${details}`);
}

process.stdout.write(`Cargo licence policy passed for ${thirdParty.length} third-party crates.\n`);
