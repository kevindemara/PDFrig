import path from 'node:path';

const privateDirectories = new Set([
  '.git',
  '.tooling',
  '.next',
  '.next-qa',
  '.turbo',
  '.pnpm-store',
  'node_modules',
  'target',
  'dist',
  'coverage',
  'tmp',
  'output',
  'artifacts',
  'releases',
  'playwright-report',
  'test-results',
  '.idea',
  '.vscode',
  '__pycache__',
]);
const privateExtensions = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.exe',
  '.msi',
  '.msix',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.log',
  '.bak',
  '.orig',
  '.patch',
  '.tsbuildinfo',
  '.pyc',
  '.pyo',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.dmp',
]);
export const documentAssetExtensions = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
]);

export function publicationPathIssues(file, approvedAssets = new Set()) {
  const normalized = file.replaceAll('\\', '/');
  const parts = normalized.split('/');
  const lowerParts = parts.map((part) => part.toLowerCase());
  const name = lowerParts.at(-1);
  const extension = path.posix.extname(name);
  const issues = [];
  if (
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    parts.some((part) => part === '..' || part === '.' || part === '')
  )
    issues.push('UNSAFE_REPOSITORY_PATH');
  if (/\.(?:md|markdown|mdx)$/iu.test(normalized) && normalized !== 'README.md')
    issues.push('ONLY_ROOT_README_MARKDOWN_ALLOWED');
  if (
    lowerParts.some((part) => privateDirectories.has(part)) ||
    name === 'next-env.d.ts' ||
    name === 'thumbs.db' ||
    name === '.ds_store'
  )
    issues.push('PRIVATE_OR_GENERATED_FILE');
  if (
    (name.startsWith('.env') && normalized !== '.env.example') ||
    /^(?:credentials|id_rsa|id_ed25519)(?:[._-]|$)/u.test(name) ||
    privateExtensions.has(extension)
  )
    issues.push('PRIVATE_OR_RELEASE_ARTIFACT');
  if (documentAssetExtensions.has(extension) && !approvedAssets.has(normalized))
    issues.push('UNREVIEWED_DOCUMENT_OR_ASSET');
  return issues;
}

// Rule names, never matching values, may be printed. Synthetic canaries in tests
// construct candidate secrets in memory rather than storing usable credentials.
const contentRules = [
  ['PRIVATE_KEY', /-----BEGIN (?:ENCRYPTED |EC |OPENSSH |RSA |DSA )?PRIVATE KEY-----/u],
  ['AWS_ACCESS_KEY', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u],
  ['GITHUB_TOKEN', /\b(?:gh[oprsu]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b/u],
  ['STRIPE_SECRET', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/u],
  ['STRIPE_WEBHOOK_SECRET', /\bwhsec_[A-Za-z0-9]{24,}\b/u],
  ['SUPABASE_SECRET', /\bsb_secret_[A-Za-z0-9._-]{16,}\b/u],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u],
  [
    'PERSONAL_WINDOWS_PATH',
    /[A-Z]:[\\/]Users[\\/](?!Public(?:[\\/]|$)|Default(?:[\\/]|$)|path(?:[\\/]|$))[^\\/\s'"<>]+[\\/]/iu,
  ],
];

export function sensitiveContentIssues(contents) {
  return contentRules.filter(([, pattern]) => pattern.test(contents)).map(([code]) => code);
}
