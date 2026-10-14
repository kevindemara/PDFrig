import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const owner = 'synthetic-owner-password';
const reader = 'synthetic-open-password';
const fixture = path.resolve('packages/test-corpus/fixtures/acroform-text-field.pdf');

for (const openPassword of [reader, '']) {
  test(`SEC-003 verifies reader permissions with ${openPassword === '' ? 'empty' : 'required'} open password`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    const uploads: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.method() === 'POST') uploads.push(request.url());
    });
    const original = await readFile(fixture);
    await page.goto('/tools');
    await page.getByRole('button', { name: /PDF permissions/u }).click();
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByLabel('Owner password', { exact: true }).fill(owner);
    await page.getByLabel('Open password (optional)').fill(openPassword);
    await page.getByLabel('Printing permission').selectOption('none');
    for (const label of [
      'Copy text and images',
      'Modify page content',
      'Add annotations',
      'Fill form fields',
      'Combine and rearrange pages',
    ]) {
      await page.getByLabel(label, { exact: true }).uncheck();
    }
    const create = page.getByRole('button', { name: 'Create permission copy' });
    await expect(create).toBeDisabled();
    await page.getByLabel('I am authorized to set this document’s permissions.').check();
    await expect(create).toBeDisabled();
    await page
      .getByLabel('I reviewed the password roles and understand the permission limitations.')
      .check();
    await create.click();
    const downloadButton = page.getByRole('button', { name: 'Download reviewed permission copy' });
    await expect(downloadButton).toBeDisabled();
    await expect(page.getByLabel('Owner password', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Open password (optional)')).toHaveValue('');
    await expect(
      page.getByText(
        openPassword === ''
          ? /has no open password; anyone can open and extract it/u
          : /requires the selected open password/u,
      ),
    ).toBeVisible();
    await expect(page.getByText('Accessibility extraction: always allowed')).toBeVisible();
    await page
      .getByLabel('I reviewed these permissions and will keep the owner password private.')
      .check();
    const downloading = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('pdfmason-permissions.pdf');
    const output = testInfo.outputPath('permissions.pdf');
    await download.saveAs(output);
    const qpdf = process.env.PDFMASON_QPDF_PATH ?? 'qpdf';
    execFileSync(qpdf, ['--password-file=-', '--check', output], {
      input: `${openPassword}\n`,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const plain = testInfo.outputPath('independent-decrypted.pdf');
    execFileSync(qpdf, ['--password-file=-', '--decrypt', output, plain], {
      input: `${owner}\n`,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const python =
      process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'python' : 'python3');
    execFileSync(
      python,
      [
        '-c',
        `
import json,sys
from pypdf import PdfReader
credentials=json.load(sys.stdin)
source=PdfReader(sys.argv[1],strict=True)
r=PdfReader(sys.argv[2],strict=True)
assert r.is_encrypted
e=r.trailer['/Encrypt'].get_object()
assert (int(e['/V']),int(e['/R']),int(e['/Length']),int(e['/P']))==(5,6,256,-3392)
assert e['/CF']['/StdCF']['/CFM']=='/AESV3'
assert r.decrypt('wrong-synthetic-password')==0
assert r.decrypt(credentials['reader'])==1
assert r.decrypt(credentials['owner'])==2
plain=PdfReader(sys.argv[3],strict=True)
assert not plain.is_encrypted
assert len(source.pages)==len(plain.pages)==1
assert source.metadata==plain.metadata
assert source.get_fields().keys()==plain.get_fields().keys()
assert [(k,v.get('/V')) for k,v in source.get_fields().items()]==[(k,v.get('/V')) for k,v in plain.get_fields().items()]
for a,b in zip(source.pages,plain.pages):
 assert (list(a.mediabox),list(a.cropbox),a.rotation,a.extract_text(),a.get_contents().get_data())==(list(b.mediabox),list(b.cropbox),b.rotation,b.extract_text(),b.get_contents().get_data())
`,
        fixture,
        output,
        plain,
      ],
      { input: JSON.stringify({ owner, reader: openPassword }), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const sourcePrefix = testInfo.outputPath('source');
    const copyPrefix = testInfo.outputPath('copy');
    for (const [pdf, prefix] of [
      [fixture, sourcePrefix],
      [plain, copyPrefix],
    ] as const) {
      execFileSync(
        process.env.PDFMASON_PDFTOPPM_PATH ?? 'pdftoppm',
        ['-f', '1', '-singlefile', '-r', '72', pdf, prefix],
        {
          stdio: 'pipe',
        },
      );
    }
    expect(await readFile(`${sourcePrefix}.ppm`)).toEqual(await readFile(`${copyPrefix}.ppm`));
    expect(await readFile(fixture)).toEqual(original);
    await page.getByLabel('Copy text and images', { exact: true }).check();
    await expect(downloadButton).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(uploads).toEqual([]);
  });
}

test('SEC-003 fails closed for unsafe input and remains accessible at 390px', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tools');
  await page.getByRole('button', { name: /PDF permissions/u }).click();
  const choose = page.locator('input[type="file"]');
  await choose.setInputFiles(path.resolve('packages/test-corpus/fixtures/signature-field.pdf'));
  await page.getByLabel('Owner password', { exact: true }).fill(owner);
  await page.getByLabel('Open password (optional)').fill('short');
  const create = page.getByRole('button', { name: 'Create permission copy' });
  await expect(create).toBeDisabled();
  await page.getByLabel('Open password (optional)').fill(reader);
  await page.getByLabel('I am authorized to set this document’s permissions.').check();
  await page
    .getByLabel('I reviewed the password roles and understand the permission limitations.')
    .check();
  await create.click();
  await expect(page.locator('.utility-status[role="alert"]')).toContainText('signature structures');
  await expect(page.getByRole('button', { name: 'Download reviewed permission copy' })).toHaveCount(
    0,
  );
  await expect(page.getByLabel('Owner password', { exact: true })).toHaveValue('');
  await choose.setInputFiles(fixture);
  await expect(
    page.getByLabel('I am authorized to set this document’s permissions.'),
  ).not.toBeChecked();
  await expect(create).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('permissions-compact.png'), fullPage: true });
});
