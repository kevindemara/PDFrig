// Exact reviewed server-only versions; not permission to redistribute a Windows installer.
const nativePlatforms = new Set([
  'darwin-arm64',
  'darwin-x64',
  'freebsd-wasm32',
  'linux-arm',
  'linux-arm64',
  'linux-ppc64',
  'linux-riscv64',
  'linux-s390x',
  'linux-x64',
  'linuxmusl-arm64',
  'linuxmusl-x64',
  'webcontainers-wasm32',
  'win32-arm64',
  'win32-ia32',
  'win32-x64',
]);
const libvipsPlatforms = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm',
  'linux-arm64',
  'linux-ppc64',
  'linux-riscv64',
  'linux-s390x',
  'linux-x64',
  'linuxmusl-arm64',
  'linuxmusl-x64',
]);

export const reviewedSharpLicense = (license, packages) =>
  packages.length > 0 &&
  packages.every(({ name, versions }) => {
    if (versions.length !== 1) return false;
    if (license === 'Apache-2.0 AND LGPL-3.0-or-later')
      return (
        name.startsWith('@img/sharp-') &&
        nativePlatforms.has(name.slice('@img/sharp-'.length)) &&
        versions[0] === '0.35.5'
      );
    if (license === 'LGPL-3.0-or-later')
      return (
        name.startsWith('@img/sharp-libvips-') &&
        libvipsPlatforms.has(name.slice('@img/sharp-libvips-'.length)) &&
        versions[0] === '1.3.4'
      );
    return false;
  });

const sharpName = (name) => name === 'sharp' || name.startsWith('@img/sharp-');
export const containsSharpRuntime = (value) => {
  if (value === null || typeof value !== 'object') return false;
  if (typeof value.name === 'string' && sharpName(value.name)) return true;
  return Object.entries(value).some(
    ([key, child]) => sharpName(key) || containsSharpRuntime(child),
  );
};
