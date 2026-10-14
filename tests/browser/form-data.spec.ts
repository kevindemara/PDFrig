import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('FORM-003 JSON review, all-field undo, export, refusal and immutable PDF round trip', async ({
  page,
}, testInfo) => {
  const source = path.resolve('packages/test-corpus/fixtures/acroform-text-field.pdf');
  const sourceBefore = await readFile(source);
  await page.goto('/workspace');
  await page.locator('input[type="file"]').first().setInputFiles(source);
  await expect(page.getByRole('heading', { name: 'Fill fields' })).toBeVisible();
  const input = page.getByLabel('Import form data JSON');
  const data = {
    schema: 'pdfmason.form-data',
    version: 1,
    fields: [
      { fieldName: 'synthetic.name', type: 'text', value: 'Form Data Reviewer' },
      { fieldName: 'synthetic.approved', type: 'checkbox', value: true },
      { fieldName: 'synthetic.choice', type: 'radio', value: 'B' },
      { fieldName: 'synthetic.province', type: 'dropdown', value: 'QC' },
    ],
  };
  const choose = async (payload: unknown) =>
    input.setInputFiles({
      name: 'private-data.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(payload)),
    });
  await choose(data);
  await expect(page.getByRole('heading', { name: 'Review 4 field values' })).toBeVisible();
  await expect(page.getByLabel('synthetic.name', { exact: true })).not.toHaveValue(
    'Form Data Reviewer',
  );
  expect(
    (await new AxeBuilder({ page }).include('[aria-label="Form data"]').analyze()).violations,
  ).toEqual([]);
  await page.getByRole('region', { name: 'Form data' }).screenshot({
    path: testInfo.outputPath('form-data-review.png'),
  });
  await page.getByRole('button', { name: 'Apply reviewed form data' }).click();
  await expect(page.getByLabel('synthetic.name', { exact: true })).toHaveValue(
    'Form Data Reviewer',
  );
  await expect(page.getByLabel('synthetic.approved', { exact: true })).toBeChecked();
  await expect(page.getByLabel('synthetic.choice: B')).toBeChecked();
  await expect(page.getByLabel('synthetic.province', { exact: true })).toHaveValue('QC');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('synthetic.name', { exact: true })).not.toHaveValue(
    'Form Data Reviewer',
  );
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('synthetic.name', { exact: true })).toHaveValue(
    'Form Data Reviewer',
  );
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export form data' }).click();
  const downloaded = await jsonDownload;
  expect(downloaded.suggestedFilename()).toBe('pdfmason-form-data.json');
  const outputJson = testInfo.outputPath('form-data.json');
  await downloaded.saveAs(outputJson);
  expect(JSON.parse(await readFile(outputJson, 'utf8'))).toEqual({
    ...data,
    fields: [...data.fields].sort((a, b) => a.fieldName.localeCompare(b.fieldName)),
  });
  await choose({
    ...data,
    fields: [
      ...data.fields,
      { fieldName: 'UNKNOWN_CONTENT_CANARY', type: 'text', value: 'SECRET_CANARY' },
    ],
  });
  await expect(page.getByRole('region', { name: 'Form data' }).getByRole('alert')).toContainText(
    'No values changed',
  );
  await expect(page.getByText(/UNKNOWN_CONTENT_CANARY|SECRET_CANARY/)).toHaveCount(0);
  await expect(page.getByLabel('synthetic.name', { exact: true })).toHaveValue(
    'Form Data Reviewer',
  );
  await choose(data);
  await page.getByRole('button', { name: 'Cancel import' }).click();
  await expect(page.getByRole('button', { name: 'Apply reviewed form data' })).toHaveCount(0);
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Review export' }).click();
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const pdfOutput = testInfo.outputPath('form-data-filled.pdf');
  await (await pdfDownload).saveAs(pdfOutput);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', pdfOutput], { stdio: 'pipe' });
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const prefix =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  execFileSync(python, [...prefix, path.resolve('scripts/verify-form-data-output.py'), pdfOutput], {
    stdio: 'pipe',
  });
  const poppler = process.env.PDFMASON_PDFTOPPM_PATH ?? 'pdftoppm';
  execFileSync(
    poppler,
    [
      '-scale-to',
      '1200',
      '-singlefile',
      '-png',
      pdfOutput,
      testInfo.outputPath('form-data-render'),
    ],
    { stdio: 'pipe' },
  );
  // Explicit empty choices must clear canonical values and widget selection, not select "".
  await choose({
    ...data,
    fields: [
      { fieldName: 'synthetic.approved', type: 'checkbox', value: false },
      { fieldName: 'synthetic.choice', type: 'radio', value: '' },
      { fieldName: 'synthetic.province', type: 'dropdown', value: '' },
    ],
  });
  await page.getByRole('button', { name: 'Apply reviewed form data' }).click();
  await expect(page.getByLabel('synthetic.choice: B')).not.toBeChecked();
  await expect(page.getByLabel('synthetic.name', { exact: true })).toHaveValue(
    'Form Data Reviewer',
  );
  const clearedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Review export' }).click();
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const clearedOutput = testInfo.outputPath('form-data-cleared.pdf');
  await (await clearedDownload).saveAs(clearedOutput);
  execFileSync(qpdf, ['--check', clearedOutput], { stdio: 'pipe' });
  execFileSync(
    python,
    [...prefix, path.resolve('scripts/verify-form-data-output.py'), clearedOutput, '--cleared'],
    { stdio: 'pipe' },
  );
  execFileSync(
    poppler,
    [
      '-scale-to',
      '1200',
      '-singlefile',
      '-png',
      clearedOutput,
      testInfo.outputPath('form-data-cleared-render'),
    ],
    { stdio: 'pipe' },
  );
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('FORM-003 never exposes data import or export on an active-content locked document', async ({
  page,
}) => {
  await page.goto('/workspace');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(
      path.resolve('packages/test-corpus/fixtures/signature-with-text-field-action.pdf'),
    );
  await expect(page.getByText(/embedded JavaScript/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export form data' })).toHaveCount(0);
  await expect(page.getByLabel('Import form data JSON')).toHaveCount(0);
});
