import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { documentAssetExtensions, sensitiveContentIssues } from './repository-hygiene-policy.mjs';
import { repositoryFiles } from './repository-files.mjs';

const files = await repositoryFiles();
const findings = [];
for (const file of files) {
  const name = path.basename(file.relative);
  if (name.startsWith('.env') && file.relative !== '.env.example') {
    findings.push(`${file.relative}: ENVIRONMENT_FILE`);
    continue;
  }
  // Inspect all text, including extensionless files, Python, TXT, CSV and FODP.
  // Reviewed binary assets have a separate provenance/hash gate.
  if (documentAssetExtensions.has(path.extname(name).toLowerCase())) continue;
  if (file.size > 2_000_000) {
    findings.push(`${file.relative}: TEXT_SCAN_SIZE_LIMIT`);
    continue;
  }
  const bytes = await readFile(file.absolute);
  let contents;
  try {
    contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    findings.push(`${file.relative}: UNREVIEWED_NON_UTF8_FILE`);
    continue;
  }
  for (const code of sensitiveContentIssues(contents)) findings.push(`${file.relative}: ${code}`);
}
if (findings.length) throw new Error(`Sensitive-file scan failed:\n${findings.join('\n')}`);
console.log(
  `Sensitive-file scan passed for ${files.length} current repository files. Git history and binary contents require separate review.`,
);
