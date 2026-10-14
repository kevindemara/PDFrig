import { execFileSync } from 'node:child_process';
import {
  documentAssetExtensions,
  publicationPathIssues,
  sensitiveContentIssues,
} from './repository-hygiene-policy.mjs';
import { repositoryRoot } from './repository-files.mjs';
import path from 'node:path';

// Read-only audit of locally available reachable history, not remote refs,
// reflogs, GitHub caches, forks or backups. Never prints blob contents, matching
// values, document names or author email addresses; does not rewrite anything.
const git = (args, options = {}) =>
  execFileSync('git', args, {
    cwd: repositoryRoot,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
const listing = git(['rev-list', '--all', '--objects'], { encoding: 'utf8' });
const entries = listing
  .trim()
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => {
    const space = line.indexOf(' ');
    return {
      id: space < 0 ? line : line.slice(0, space),
      file: space < 0 ? '' : line.slice(space + 1),
    };
  });
const objects = git(['cat-file', '--batch'], {
  input: entries.length ? entries.map((entry) => entry.id).join('\n') + '\n' : '',
});
const contentFindings = {};
const pathFindings = {};
let cursor = 0;
let textBlobs = 0;
let binaryBlobs = 0;
let unscannedBlobs = 0;
const count = (target, codes) => {
  for (const code of codes) target[code] = (target[code] ?? 0) + 1;
};
for (const entry of entries) {
  const end = objects.indexOf(10, cursor);
  if (end < 0) throw new Error('HISTORY_AUDIT_INCOMPLETE');
  const header = objects.subarray(cursor, end).toString('ascii').split(' ');
  const size = Number(header[2]);
  if (header[0] !== entry.id || !Number.isSafeInteger(size) || size < 0)
    throw new Error('HISTORY_AUDIT_INCOMPLETE');
  cursor = end + 1;
  const bytes = objects.subarray(cursor, cursor + size);
  cursor += size + 1;
  if (header[1] !== 'blob') continue;
  // All history assets are separately reviewed as binary; the path scan still
  // flags private keys/artifacts. Extra Markdown in history is expected.
  const approved = new Set([entry.file]);
  count(
    pathFindings,
    publicationPathIssues(entry.file, approved).filter(
      (code) => code !== 'ONLY_ROOT_README_MARKDOWN_ALLOWED',
    ),
  );
  if (documentAssetExtensions.has(path.extname(entry.file).toLowerCase())) {
    binaryBlobs++;
    continue;
  }
  if (size > 2_000_000) {
    unscannedBlobs++;
    continue;
  }
  let contents;
  try {
    contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    unscannedBlobs++;
    continue;
  }
  textBlobs++;
  count(contentFindings, sensitiveContentIssues(contents));
}
const authors = new Set(
  git(['log', '--all', '--format=%ae%n%ce'], { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean),
);
console.log(
  JSON.stringify(
    {
      scope: 'locally reachable refs only; binary contents and remote caches are not certified',
      historyRewritten: false,
      objects: entries.length,
      textBlobs,
      binaryBlobs,
      unscannedBlobs,
      pathFindings,
      contentFindings,
      nonNoreplyAuthorAddresses: [...authors].filter(
        (address) =>
          !address.endsWith('@users.noreply.github.com') && address !== 'noreply@github.com',
      ).length,
    },
    null,
    2,
  ),
);
