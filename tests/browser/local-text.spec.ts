import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';

for (const [mode, filename] of [
  ['edit', 'smoke-one-page.pdf'],
  ['edit', 'tagged-bookmarks.pdf'],
  ['ocr', 'scanned-ocr.pdf'],
] as const)
  test(`EDIT-002 OCR-001 ${filename}: local review, undo and independently verified export`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const fixture = path.resolve(`packages/test-corpus/fixtures/${filename}`);
    const source = await readFile(fixture);
    const errors: string[] = [];
    const outbound: string[] = [];
    if (mode === 'ocr') {
      // The worker must also work under the production policy, without general JS eval.
      await page.route('**/ocr/worker.min.js', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          headers: {
            ...response.headers(),
            'content-security-policy':
              "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",
          },
        });
      });
    }
    page.on('pageerror', (error) => errors.push(error.name));
    page.on('request', (request) => {
      if (
        request.method() === 'POST' ||
        (!request.url().startsWith('http://127.0.0.1:3100') &&
          !request.url().startsWith('data:') &&
          !request.url().startsWith('blob:'))
      )
        outbound.push('unexpected-request');
    });
    await page.goto('/workspace');
    await expect(page.getByLabel('Open PDF')).toBeEnabled();
    await page.getByLabel('Open PDF').setInputFiles(fixture);
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page
      .getByRole('button', {
        name: mode === 'edit' ? 'Edit existing text' : 'OCR this page',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog', {
      name: mode === 'edit' ? 'Edit existing text' : 'OCR · search and copy',
    });
    let original = '';
    if (mode === 'edit') {
      await expect(dialog.getByLabel('Replacement text')).toBeEnabled();
      await dialog.getByLabel('Text layout', { exact: true }).selectOption('inline');
      if (filename === 'tagged-bookmarks.pdf')
        await dialog
          .getByRole('combobox', { name: 'Original text', exact: true })
          .selectOption({ label: 'Tagged synthetic paragraph 1' });
      original = await dialog.getByLabel('Replacement text').inputValue();
      await dialog.getByLabel('Replacement text').fill('EDIT');
    }
    await dialog.getByRole('button', { name: 'Build actual PDF preview' }).click();
    await expect(dialog.getByRole('button', { name: 'Apply reviewed copy' })).toBeDisabled();
    await expect(dialog.getByRole('status')).toContainText(
      mode === 'edit' ? 'actual exported-PDF preview' : 'Scan appearance is unchanged',
      { timeout: 60_000 },
    );
    if (mode === 'ocr')
      await expect(
        dialog.getByRole('textbox', { name: 'Recognized text', exact: true }),
      ).toHaveValue(/OCR FIXTURE 4827/);
    const axe = await new AxeBuilder({ page })
      .include('.source-text-dialog')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations).toEqual([]);
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Apply reviewed copy' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    if (mode === 'ocr') {
      await page.getByRole('button', { name: 'Select text', exact: true }).click();
      await expect(page.locator('.pdf-text-layer')).toContainText(/OCR\s*FIXTURE\s*4827/);
      await page.getByRole('searchbox', { name: 'Search this PDF', exact: true }).fill('4827');
      await page.getByRole('button', { name: 'Find', exact: true }).click();
      await expect(page.getByRole('button', { name: /OCR FIXTURE 4827/ })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Review export' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export completed copy' }).click();
    const output = info.outputPath(`${mode}.pdf`);
    await (await download).saveAs(output);
    execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', output], { stdio: 'pipe' });
    const text = execFileSync('pdftotext', [output, '-'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(text).toContain(mode === 'edit' ? 'EDIT' : 'OCR FIXTURE 4827');
    if (mode === 'edit') {
      const report = JSON.parse(
        execFileSync(
          process.env.PDFMASON_PYTHON_PATH ?? 'python',
          ['scripts/verify-source-text-spike.py', fixture, output, original, 'EDIT', 'auto'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      ) as Record<string, boolean>;
      expect(report).toEqual({
        sourceReplaced: true,
        outsidePixelsEqual: true,
        textGeometryRetained: true,
        taggedActualTextConsistent: true,
        bookmarksRetained: true,
      });
    }
    if (mode === 'ocr') {
      const before = info.outputPath('before');
      const after = info.outputPath('after');
      for (const [file, prefix] of [
        [fixture, before],
        [output, after],
      ] as const)
        execFileSync('pdftoppm', ['-singlefile', '-png', '-r', '144', file, prefix], {
          stdio: 'pipe',
        });
      expect(await readFile(`${after}.png`)).toEqual(await readFile(`${before}.png`));
    }
    expect(await readFile(fixture)).toEqual(source);
    expect(errors).toEqual([]);
    expect(outbound).toEqual([]);
  });

test('OCR-001 refuses duplicate searchable text and Cancel leaves no change', async ({ page }) => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .getByLabel('Open PDF')
    .setInputFiles('packages/test-corpus/fixtures/smoke-one-page.pdf');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'OCR this page', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'OCR · search and copy' });
  await dialog.getByRole('button', { name: 'Build actual PDF preview' }).click();
  await expect(dialog.getByRole('status')).toContainText('already contains searchable text');
  await expect(dialog.getByRole('button', { name: 'Apply reviewed copy' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
