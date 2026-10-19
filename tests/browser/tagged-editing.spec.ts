import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('EDIT-001 FORM-002 VIEW-006 edits tagged/bookmarked PDFs and preserves their original structure', async ({
  page,
}, testInfo) => {
  const source = path.resolve('packages/test-corpus/fixtures/tagged-bookmarks.pdf');
  const before = await readFile(source);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(source);
  await expect(page.locator('.workspace-warning')).toContainText('Editing available');
  await expect(page.getByText('Protected document', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/editing export is locked/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review export' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Extract this page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  await page.getByRole('textbox', { name: 'tagged-field', exact: true }).fill('Filled value');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Tagged document overlay');
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  const printDialog = page.getByRole('dialog', { name: 'Print this working copy' });
  await printDialog.getByRole('button', { name: 'Prepare print' }).click();
  await expect(printDialog.getByRole('status')).toContainText('2 of 2 pages ready');
  await expect(printDialog.getByRole('button', { name: 'Open print dialog' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close print dialog' }).click();
  await page.getByRole('button', { name: 'Review export' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review your completed copy' });
  await expect(dialog).toContainText('Added content is not tagged');
  await expect(dialog.getByRole('radio', { name: 'Flatten filled fields' })).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: 'Keep fields interactive' })).toBeChecked();
  const accessibility = await new AxeBuilder({ page })
    .include('.export-dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('tagged-edited.pdf');
  await (await download).saveAs(output);
  const qpdf = process.env.PDFMASON_QPDF_PATH ?? 'qpdf';
  const python = process.env.PDFMASON_PYTHON_PATH ?? 'python';
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  execFileSync(python, [path.resolve('scripts/verify-pdf-tags.py'), source, output], {
    stdio: 'pipe',
  });
  // The second (rotated) page receives no edits and must render identically.
  const render = (file: string, label: string, pageNumber = 2): Buffer => {
    const prefix = testInfo.outputPath(label);
    execFileSync(
      'pdftoppm',
      [
        '-f',
        String(pageNumber),
        '-l',
        String(pageNumber),
        '-singlefile',
        '-r',
        '72',
        '-png',
        file,
        prefix,
      ],
      { stdio: 'pipe' },
    );
    return execFileSync(
      python,
      [
        '-c',
        'import sys; from PIL import Image; sys.stdout.buffer.write(Image.open(sys.argv[1]).convert("RGB").tobytes())',
        `${prefix}.png`,
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
  };
  expect(render(output, 'tagged-output')).toEqual(render(source, 'tagged-source'));
  render(output, 'tagged-edited-page', 1);
  render(source, 'tagged-original-page', 1);
  execFileSync(
    python,
    [
      '-c',
      'import sys; from PIL import Image, ImageChops, ImageDraw; a=Image.open(sys.argv[1]).convert("RGB"); b=Image.open(sys.argv[2]).convert("RGB"); assert a.size == b.size; assert ImageChops.difference(a,b).getbbox() is not None; [ImageDraw.Draw(im).rectangle(box,fill="white") for im in [a,b] for box in [(200,340,410,450),(50,580,260,617)]]; assert ImageChops.difference(a,b).getbbox() is None',
      testInfo.outputPath('tagged-original-page.png'),
      testInfo.outputPath('tagged-edited-page.png'),
    ],
    { stdio: 'pipe' },
  );
  await page.getByLabel('Open PDF').setInputFiles(output);
  await expect(page.locator('.workspace-warning')).toContainText('Editing available');
  await expect(page.getByRole('region', { name: 'Selectable PDF text' })).toContainText(
    'Tagged document overlay',
  );
  await expect(page.getByRole('region', { name: 'Document outline' })).toContainText(
    'Tagged chapter',
  );
  expect(await readFile(source)).toEqual(before);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('tagged-editor.png') });
});
