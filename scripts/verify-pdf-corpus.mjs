import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mkdtemp } from 'node:fs/promises';

const fixtureDirectory = resolve('packages/test-corpus/fixtures');
const manifest = JSON.parse(await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8'));
const pdfInfo = process.env.PDFMASON_PDFINFO_PATH ?? 'pdfinfo';
const pdfToPpm =
  process.env.PDFMASON_PDFTOPPM_PATH ??
  (pdfInfo === 'pdfinfo' ? 'pdftoppm' : join(dirname(pdfInfo), 'pdftoppm.exe'));
const configuredPython = process.env.PDFMASON_PYTHON_PATH;
const python = configuredPython ?? (process.platform === 'win32' ? 'py' : 'python');
const pythonPrefixArguments =
  configuredPython === undefined && process.platform === 'win32' ? ['-3'] : [];
const keepVerificationOutput = process.env.PDFMASON_KEEP_VERIFICATION_OUTPUT === '1';

for (const fixture of manifest.fixtures) {
  const input = join(fixtureDirectory, fixture.filename);
  const passwordArgs = fixture.expectedWarnings.includes('ENCRYPTED')
    ? ['-upw', 'pdfmason-test']
    : [];
  const output = execFileSync(pdfInfo, [...passwordArgs, input], { encoding: 'utf8' });
  const pageCount = /^Pages:\s+(\d+)$/mu.exec(output)?.[1];
  if (Number(pageCount) !== fixture.expectedPageCount) {
    throw new Error(`${fixture.filename}: independent reader reported ${pageCount ?? 'no'} pages.`);
  }
}

execFileSync(
  python,
  [
    ...pythonPrefixArguments,
    resolve('scripts/verify-pdf-outline.py'),
    join(fixtureDirectory, 'outline-navigation.pdf'),
  ],
  { stdio: 'inherit' },
);

execFileSync(
  python,
  [
    ...pythonPrefixArguments,
    resolve('scripts/verify-pdf-signature-fixtures.py'),
    join(fixtureDirectory, 'signature-field-empty.pdf'),
    join(fixtureDirectory, 'signature-field-action.pdf'),
    join(fixtureDirectory, 'signature-malformed-value.pdf'),
    join(fixtureDirectory, 'signature-orphan-widget.pdf'),
    join(fixtureDirectory, 'signature-parent-field-action.pdf'),
    join(fixtureDirectory, 'signature-child-widget-action.pdf'),
    join(fixtureDirectory, 'signature-cross-page-action.pdf'),
    join(fixtureDirectory, 'signature-with-text-field.pdf'),
    join(fixtureDirectory, 'signature-with-text-field-action.pdf'),
    join(fixtureDirectory, 'signature-field.pdf'),
    join(fixtureDirectory, 'signature-metadata-placeholder.pdf'),
    join(fixtureDirectory, 'signature-mixed-fields.pdf'),
    join(fixtureDirectory, 'signature-byte-range-out-of-bounds.pdf'),
    join(fixtureDirectory, 'signature-parent-widget.pdf'),
  ],
  { stdio: 'inherit' },
);

const renderDirectory = await mkdtemp(join(tmpdir(), 'pdfmason-corpus-'));
try {
  const { assemblePdf } = await import('../packages/pdf-engine/dist/assembly.js');
  const { exportEditedPdf } = await import('../packages/pdf-engine/dist/editing.js');
  const sourceBytes = await readFile(join(fixtureDirectory, 'multipage-three.pdf'));
  const assembledBytes = await assemblePdf(
    [{ bytes: sourceBytes, sourceId: 'independent-verification-source' }],
    [
      { rotation: 90, sourceId: 'independent-verification-source', sourcePageIndex: 2 },
      { rotation: 0, sourceId: 'independent-verification-source', sourcePageIndex: 0 },
      { rotation: 0, sourceId: 'independent-verification-source', sourcePageIndex: 2 },
    ],
  );
  const assembledPath = join(renderDirectory, 'assembled-output.pdf');
  await writeFile(assembledPath, assembledBytes);
  const assembledInfo = execFileSync(pdfInfo, [assembledPath], { encoding: 'utf8' });
  if (!/^Pages:\s+3$/mu.test(assembledInfo)) {
    throw new Error('The independent reader did not open the three-page organizer output.');
  }

  const overlaySource = await readFile(join(fixtureDirectory, 'smoke-one-page.pdf'));
  const overlaySourceId = 'independent-overlay-source';
  const overlayPageId = 'independent-overlay-page';
  const annotatedBytes = await exportEditedPdf({
    annotations: [
      {
        alignment: 'left',
        color: '#17232d',
        fontSize: 18,
        id: 'independent-text',
        kind: 'text',
        pageId: overlayPageId,
        rect: { height: 0.08, width: 0.38, x: 0.17, y: 0.18 },
        text: 'Reviewed locally',
        variant: 'box',
      },
      {
        appearance: { color: '#17232d', kind: 'typed', text: 'Synthetic Signer' },
        id: 'independent-signature',
        kind: 'visual-signature',
        label: 'signature',
        pageId: overlayPageId,
        rect: { height: 0.09, width: 0.36, x: 0.45, y: 0.76 },
      },
      {
        color: '#f4d35e',
        id: 'independent-highlight',
        kind: 'markup',
        opacity: 0.35,
        pageId: overlayPageId,
        rect: { height: 0.04, width: 0.42, x: 0.2, y: 0.42 },
        style: 'highlight',
      },
      {
        color: '#26756f',
        id: 'independent-stamp',
        kind: 'stamp',
        pageId: overlayPageId,
        rect: { height: 0.09, width: 0.34, x: 0.16, y: 0.82 },
        source: 'custom',
        text: 'QA passed',
      },
    ],
    formValues: [],
    options: { flattenForms: false },
    pages: [
      {
        pageId: overlayPageId,
        rotation: 90,
        sourceId: overlaySourceId,
        sourcePageIndex: 0,
      },
    ],
    sources: [{ bytes: overlaySource, sourceId: overlaySourceId }],
  });
  const annotatedPath = join(renderDirectory, 'annotated-rotated-output.pdf');
  await writeFile(annotatedPath, annotatedBytes);

  const formSource = await readFile(join(fixtureDirectory, 'acroform-text-field.pdf'));
  const formSourceId = 'independent-form-source';
  const formRequest = {
    annotations: [],
    formValues: [
      {
        fieldName: 'synthetic.name',
        sourceId: formSourceId,
        type: 'text',
        value: 'Fixture Reviewer',
      },
      { fieldName: 'synthetic.approved', sourceId: formSourceId, type: 'checkbox', value: true },
      { fieldName: 'synthetic.choice', sourceId: formSourceId, type: 'radio', value: 'B' },
      { fieldName: 'synthetic.province', sourceId: formSourceId, type: 'dropdown', value: 'QC' },
    ],
    pages: [
      {
        pageId: 'independent-form-page',
        rotation: 0,
        sourceId: formSourceId,
        sourcePageIndex: 0,
      },
    ],
    sources: [{ bytes: formSource, sourceId: formSourceId }],
  };
  const interactivePath = join(renderDirectory, 'filled-interactive-output.pdf');
  const flattenedPath = join(renderDirectory, 'filled-flattened-output.pdf');
  await writeFile(
    interactivePath,
    await exportEditedPdf({ ...formRequest, options: { flattenForms: false } }),
  );
  await writeFile(
    flattenedPath,
    await exportEditedPdf({ ...formRequest, options: { flattenForms: true } }),
  );

  for (const outputPath of [annotatedPath, interactivePath, flattenedPath]) {
    const outputInfo = execFileSync(pdfInfo, [outputPath], { encoding: 'utf8' });
    if (!/^Pages:\s+1$/mu.test(outputInfo)) {
      throw new Error(`${outputPath}: the independent reader could not reopen the edited output.`);
    }
  }

  execFileSync(
    python,
    [
      ...pythonPrefixArguments,
      resolve('scripts/verify-pdf-forms.py'),
      annotatedPath,
      interactivePath,
      flattenedPath,
    ],
    { stdio: 'inherit' },
  );

  for (const input of [
    join(fixtureDirectory, 'cropped-page.pdf'),
    join(fixtureDirectory, 'vector-shapes.pdf'),
    assembledPath,
    annotatedPath,
    interactivePath,
    flattenedPath,
  ]) {
    const filename = input.split(/[\\/]/u).at(-1);
    if (filename === undefined) throw new Error('A render verification filename is unavailable.');
    const target = join(renderDirectory, filename.replace(/\.pdf$/u, ''));
    execFileSync(pdfToPpm, ['-f', '1', '-singlefile', '-png', '-r', '96', input, target]);
    const rendered = await readFile(`${target}.png`);
    if (rendered.byteLength < 1_000 || rendered.subarray(1, 4).toString('ascii') !== 'PNG') {
      throw new Error(`${filename}: independent render output is invalid.`);
    }
  }
} finally {
  if (keepVerificationOutput) {
    process.stdout.write(`Kept independent render evidence at ${renderDirectory}.\n`);
  } else {
    await rm(renderDirectory, { force: true, recursive: true });
  }
}

process.stdout.write(
  `Independent PDF verification passed for ${manifest.fixtures.length} fixtures, the outline structure, organizer output, Milestone 2 edited outputs, and 6 representative renders.\n`,
);
