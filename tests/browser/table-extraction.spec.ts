import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('CONV-007 selectable tables, correction, local XLSX/ODS and unchanged scan OCR', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const prefix = process.platform === 'win32' && !process.env.PDFMASON_PYTHON_PATH ? ['-3'] : [];
  // Generate synthetic documents in ignored output; never publish sample PDFs.
  execFileSync(python, [...prefix, 'scripts/generate-table-examples.py'], { stdio: 'pipe' });
  const fixture = resolve('output/pdf/PDFrig-table-examples.pdf'),
    original = await readFile(fixture);
  const errors: string[] = [],
    outbound: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.context().on('request', (request) => {
    if (
      request.method() === 'POST' ||
      (!request
        .url()
        .startsWith(new URL(info.project.use.baseURL ?? 'http://127.0.0.1:3100').origin) &&
        !request.url().startsWith('blob:') &&
        !request.url().startsWith('data:'))
    )
      outbound.push(request.method());
  });
  await page.setViewportSize({ width: 1680, height: 1100 });
  await page.goto('/tools');
  await page.getByRole('button', { name: /PDF tables to spreadsheet/u }).click();
  await page.getByLabel('Open table PDF').setInputFiles(fixture);
  await expect(page.getByRole('button', { name: 'Extract selectable text' })).toBeEnabled();
  const select = async (height: number) => {
    for (const [name, value] of [
      ['Left %', 7],
      ['Top %', 19],
      ['Width %', 86],
      ['Height %', height],
    ] as const)
      await page.getByRole('spinbutton', { name, exact: true }).fill(String(value));
  };
  const review = page.getByLabel('I checked the rows, columns and values against the PDF.');
  const outputs = info.outputPath('exports');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(outputs, { recursive: true });
  const save = async (stem: string) => {
    await review.check();
    for (const format of ['XLSX', 'ODS']) {
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: `Save reviewed ${format}` }).click();
      await (await downloading).saveAs(resolve(outputs, `${stem}.${format.toLowerCase()}`));
      await expect(page.getByRole('button', { name: `Save reviewed ${format}` })).toBeEnabled();
    }
  };
  await page.locator('.table-source-page').scrollIntoViewIfNeeded();
  const sourceBox = await page.locator('.table-source-page').boundingBox();
  if (!sourceBox) throw new Error('Missing source preview');
  await page.mouse.move(
    sourceBox.x + sourceBox.width * 0.07,
    sourceBox.y + sourceBox.height * 0.19,
  );
  await page.mouse.down();
  await page.mouse.move(
    sourceBox.x + sourceBox.width * 0.93,
    sourceBox.y + sourceBox.height * 0.46,
    { steps: 8 },
  );
  await page.mouse.up();
  expect(
    Number(await page.getByRole('spinbutton', { name: 'Left %', exact: true }).inputValue()),
  ).toBeCloseTo(7, 0);
  await page.getByRole('button', { name: 'Extract selectable text' }).click();
  await expect(page.getByRole('textbox', { name: 'Row 2 column 1', exact: true })).toHaveValue(
    '00127',
  );
  expect(await page.locator('.table-correction-grid tbody tr').count()).toBe(6);
  await expect(page.getByRole('button', { name: 'Save reviewed XLSX' })).toBeDisabled();
  await review.check();
  await page.getByRole('textbox', { name: 'Row 2 column 4', exact: true }).fill('13.50');
  await expect(review).not.toBeChecked();
  await page.getByRole('textbox', { name: 'Row 2 column 4', exact: true }).fill('12.50');
  await save('inventory');
  const a11y = await new AxeBuilder({ page })
    .include('.table-workbench')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Row 2 column 4', exact: true })).toBeAttached();
  await page.setViewportSize({ width: 1680, height: 1100 });
  await page.screenshot({ path: info.outputPath('table-correction.png'), fullPage: true });
  await page.getByLabel('Table page', { exact: true }).fill('2');
  await expect(review).not.toBeAttached();
  await page.getByRole('button', { name: 'Show page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Extract selectable text' })).toBeEnabled();
  await select(24);
  await page.getByRole('button', { name: 'Extract selectable text' }).click();
  await expect(page.getByRole('textbox', { name: 'Row 2 column 4', exact: true })).toHaveValue(
    '=1+1',
  );
  expect(await page.locator('.table-correction-grid tbody tr').count()).toBe(5);
  await save('literal');
  await page.getByLabel('Table page', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Show page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'OCR scanned table' })).toBeEnabled();
  await select(27);
  // Keep loopback available: browser "offline" also blocks the local asset server.
  // Refuse every external origin instead, including any runtime CDN fallback.
  await page
    .context()
    .route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
    );
  await page.getByRole('button', { name: 'OCR scanned table' }).click();
  await expect(page.getByRole('textbox', { name: 'Row 2 column 1', exact: true })).toHaveValue(
    'Notebook',
    { timeout: 120_000 },
  );
  await save('ocr');
  execFileSync(python, [...prefix, 'scripts/verify-table-workbooks.py', outputs], {
    stdio: 'pipe',
  });
  expect(await readFile(fixture)).toEqual(original);
  expect(errors).toEqual([]);
  expect(outbound).toEqual([]);
});
