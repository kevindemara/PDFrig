import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for a Windows release build.`);
  return value;
};

const channel = required('PDFMASON_RELEASE_CHANNEL');
if (channel !== 'alpha' && channel !== 'stable')
  throw new Error('PDFMASON_RELEASE_CHANNEL must be alpha or stable.');

const version = required('PDFMASON_RELEASE_VERSION');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version))
  throw new Error('PDFMASON_RELEASE_VERSION must be a release semantic version.');

const endpointValue = required('PDFMASON_UPDATER_ENDPOINT');
const endpoint = new URL(endpointValue);
if (endpoint.protocol !== 'https:' || !endpoint.pathname.includes(`/${channel}/`)) {
  throw new Error('The updater endpoint must use HTTPS and contain the selected channel path.');
}
if (
  channel === 'stable' &&
  (endpoint.hostname.endsWith('.invalid') || endpoint.hostname === 'localhost')
)
  throw new Error('Stable updates require an approved production hostname.');
const updaterPublicKey = required('PDFMASON_UPDATER_PUBLIC_KEY');
if (updaterPublicKey.length < 80 || updaterPublicKey.length > 4_096)
  throw new Error('PDFMASON_UPDATER_PUBLIC_KEY is not a bounded Tauri updater public key.');
const publisher = process.env.PDFMASON_WINDOWS_PUBLISHER?.trim();
if (channel === 'stable' && !publisher)
  throw new Error('PDFMASON_WINDOWS_PUBLISHER is required for stable releases.');

const allowUnsignedInternalAlpha =
  process.env.PDFMASON_ALLOW_UNSIGNED_INTERNAL_ALPHA === 'true' && channel === 'alpha';
const certificateThumbprint = process.env.PDFMASON_WINDOWS_CERTIFICATE_THUMBPRINT?.trim();
const timestampUrlValue = process.env.PDFMASON_WINDOWS_TIMESTAMP_URL?.trim();
if (!allowUnsignedInternalAlpha) {
  if (certificateThumbprint === undefined || !/^[A-Fa-f0-9]{40}$/u.test(certificateThumbprint))
    throw new Error('A 40-character Windows certificate thumbprint is required.');
  if (timestampUrlValue === undefined || new URL(timestampUrlValue).protocol !== 'https:')
    throw new Error('A trusted HTTPS Windows timestamp URL is required.');
  if (process.env.VITE_PDFMASON_ENTITLEMENT_ENFORCED !== 'true')
    throw new Error('Distribution builds must enforce signed desktop entitlements.');
  const entitlementKeyId = required('VITE_PDFMASON_ENTITLEMENT_KEY_ID');
  const entitlementPublicKey = required('VITE_PDFMASON_ENTITLEMENT_PUBLIC_KEY');
  const supabaseEndpoint = new URL(required('VITE_SUPABASE_URL'));
  const webEndpoint = new URL(required('VITE_PDFMASON_WEB_URL'));
  required('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!/^[A-Za-z0-9._-]{3,64}$/u.test(entitlementKeyId) || entitlementPublicKey.length < 40)
    throw new Error('Desktop entitlement verification material is invalid.');
  if (supabaseEndpoint.protocol !== 'https:' || webEndpoint.protocol !== 'https:')
    throw new Error('Distribution account and web endpoints must use HTTPS.');
}

const windows = {
  allowDowngrades: false,
  digestAlgorithm: 'sha256',
  nsis: {
    compression: 'lzma',
    installMode: 'currentUser',
    installerIcon: 'icons/icon.ico',
    languages: ['English'],
    uninstallerIcon: 'icons/icon.ico',
  },
  webviewInstallMode: { silent: true, type: 'downloadBootstrapper' },
};
if (certificateThumbprint !== undefined) windows.certificateThumbprint = certificateThumbprint;
if (timestampUrlValue !== undefined) windows.timestampUrl = timestampUrlValue;

const config = {
  bundle: {
    active: true,
    category: 'Productivity',
    createUpdaterArtifacts: true,
    longDescription:
      'PDFMason is a privacy-forward workspace for viewing, organizing, and improving PDF documents.',
    publisher: publisher || 'PDFMason development',
    shortDescription: 'Build better PDFs.',
    targets: ['nsis'],
    useLocalToolsDir: true,
    windows,
  },
  identifier: process.env.PDFMASON_DESKTOP_IDENTIFIER?.trim() || 'com.pdfmason.desktop',
  plugins: {
    updater: {
      endpoints: [endpointValue],
      pubkey: updaterPublicKey,
      windows: { installMode: 'passive' },
    },
  },
  version,
};

const outputPath = resolve(
  process.env.PDFMASON_RELEASE_CONFIG_OUTPUT ??
    'apps/desktop/src-tauri/target/pdfmason-release-config.json',
);
await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
process.stdout.write(`Prepared ${channel} Tauri release configuration at ${outputPath}\n`);
