import { execFileSync } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';

export const repositoryRoot = path.resolve(import.meta.dirname, '..');

export async function repositoryFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  const files = [];
  for (const relative of new Set(output.split('\0').filter(Boolean))) {
    const absolute = path.resolve(repositoryRoot, relative);
    if (!absolute.startsWith(repositoryRoot + path.sep)) throw new Error('UNSAFE_REPOSITORY_PATH');
    try {
      const metadata = await lstat(absolute);
      if (!metadata.isFile()) throw new Error('NON_REGULAR_REPOSITORY_FILE');
      files.push({ relative, absolute, size: metadata.size });
    } catch (error) {
      // A tracked deletion is absent from the next commit and the working tree.
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return files;
}
