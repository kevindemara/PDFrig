import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { protectPdf, setPdfPermissions, unlockPdf } from '../packages/pdf-engine/dist/index.js';

// Test-only credentials for licensed/synthetic corpus files, never customer inputs.
const owner = 'synthetic-owner-password';
const open = 'synthetic-open-password';
const qpdf = process.env.PDFMASON_QPDF_PATH ?? 'qpdf';
const renderer = process.env.PDFMASON_PDFTOPPM_PATH ?? 'pdftoppm';
const configuredPython = process.env.PDFMASON_PYTHON_PATH;
const python = configuredPython ?? (process.platform === 'win32' ? 'py' : 'python');
const prefix = configuredPython === undefined && process.platform === 'win32' ? ['-3'] : [];
const restricted = {
  printing: 'none',
  copying: false,
  modifying: false,
  annotating: false,
  fillingForms: false,
  documentAssembly: false,
};
const variants = [
  restricted,
  { ...restricted, printing: 'low' },
  { ...restricted, printing: 'high' },
  ...['copying', 'modifying', 'fillingForms', 'documentAssembly'].map((key) => ({
    ...restricted,
    [key]: true,
  })),
  { ...restricted, annotating: true, fillingForms: true },
  {
    printing: 'high',
    copying: true,
    modifying: true,
    annotating: true,
    fillingForms: true,
    documentAssembly: true,
  },
];
const directory = await mkdtemp(join(tmpdir(), 'pdfmason-permissions-'));
const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  let count = 0;
  for (const fixture of ['smoke-one-page.pdf', 'multipage-three.pdf', 'acroform-text-field.pdf']) {
    const sourcePath = resolve('packages/test-corpus/fixtures', fixture);
    const source = await readFile(sourcePath);
    const original = Buffer.from(source);
    const sourcePrefix = join(directory, `source-${count}`);
    run(renderer, ['-r', '72', sourcePath, sourcePrefix]);
    const pageCount = fixture === 'multipage-three.pdf' ? 3 : 1;
    for (const [index, options] of [...variants, variants.at(-1)].entries()) {
      const emptyOpen = index === 0;
      const protectionOnly = index === variants.length;
      const bytes = protectionOnly
        ? await protectPdf(source, open)
        : await setPdfPermissions(source, options, owner, emptyOpen ? '' : open, true);
      const path = join(directory, `output-${count}.pdf`);
      await writeFile(path, bytes);
      run(qpdf, [`--password=${protectionOnly ? open : owner}`, '--check', path]);
      run(python, [
        ...prefix,
        resolve('scripts/verify-pdf-permissions.py'),
        sourcePath,
        path,
        options.printing,
        String(options.copying),
        String(options.modifying),
        String(options.annotating),
        String(options.fillingForms),
        String(options.documentAssembly),
        String(emptyOpen),
        protectionOnly ? 'protect' : 'permissions',
      ]);
      const outputPrefix = join(directory, `render-${count}`);
      run(renderer, [
        protectionOnly ? '-upw' : '-opw',
        protectionOnly ? open : owner,
        '-r',
        '72',
        path,
        outputPrefix,
      ]);
      for (let page = 1; page <= pageCount; page += 1)
        assert.deepEqual(
          await readFile(`${outputPrefix}-${page}.ppm`),
          await readFile(`${sourcePrefix}-${page}.ppm`),
          'Independent rendered pixels must match exactly.',
        );
      const unlockedPath = join(directory, `unlocked-${count}.pdf`);
      const unlockPassword = protectionOnly || (!emptyOpen && index % 2 === 1) ? open : owner;
      await writeFile(unlockedPath, await unlockPdf(bytes, unlockPassword, true));
      run(qpdf, ['--check', unlockedPath]);
      run(python, [
        ...prefix,
        resolve('scripts/verify-pdf-permissions.py'),
        sourcePath,
        unlockedPath,
        options.printing,
        String(options.copying),
        String(options.modifying),
        String(options.annotating),
        String(options.fillingForms),
        String(options.documentAssembly),
        String(emptyOpen),
        'unlocked',
      ]);
      const unlockedPrefix = join(directory, `plain-${count}`);
      run(renderer, ['-r', '72', unlockedPath, unlockedPrefix]);
      for (let page = 1; page <= pageCount; page += 1)
        assert.deepEqual(
          await readFile(`${unlockedPrefix}-${page}.ppm`),
          await readFile(`${sourcePrefix}-${page}.ppm`),
          'Unlocked rendered pixels must match exactly.',
        );
      count += 1;
    }
    assert.deepEqual(source, original);
    assert.deepEqual(await readFile(sourcePath), original);
  }
  console.log(
    `SEC-001/002/003: ${count} encrypted and ${count} unlocked independently verified outputs; exact qpdf/pypdf structure and Poppler page pixels.`,
  );
} finally {
  // Fresh task-specific temp directory only; never a repository/home/user-document path.
  await rm(directory, { recursive: true, force: true });
}
