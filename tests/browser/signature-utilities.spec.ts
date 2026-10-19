import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('SIGN-002 initials, date and checkmark export locally without saved assets', async ({
  page,
}, testInfo) => {
  const source = path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf');
  const original = await readFile(source);
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  const requests: string[] = [];
  page.on('request', (request) => {
    requests.push(request.url());
    const body = request.postData();
    if (body !== null) requests.push(body);
  });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(source);
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a visual signature' });
  await expect(dialog.getByLabel(/Save this signature for future documents/u)).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Initials', exact: true }).check();
  await dialog.getByLabel('Type your initials').fill('QZ-077');
  await dialog.getByRole('button', { name: 'Place visual initials' }).click();
  await page.getByRole('button', { name: 'Checkmark', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre', exact: true }).click();
  await page.getByRole('button', { name: /checkmark.*Arrow keys move/u }).focus();
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: 'Today’s date', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre', exact: true }).click();
  const date = await page.evaluate(() =>
    new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' }).format(new Date()),
  );
  await expect(page.getByRole('button', { name: /date.*Arrow keys move/u })).toContainText(date);
  await page.getByRole('button', { name: 'Review export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('signature-utilities.pdf');
  await (await download).saveAs(output);
  execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', output], { stdio: 'pipe' });
  const text = execFileSync('pdftotext', [output, '-'], { encoding: 'utf8' });
  expect(text).toContain('QZ-077');
  expect(text).toContain(date);
  execFileSync(
    process.env.PDFMASON_PYTHON_PATH ?? 'python',
    [
      '-c',
      'import sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1],strict=True); assert len(r.pages)==1; assert not r.get_fields(); ops=r.pages[0].get_contents().operations; assert sum(op==b"l" for args,op in ops)>=2; assert sum(op==b"S" for args,op in ops)>=2',
      output,
    ],
    { stdio: 'pipe' },
  );
  execFileSync(
    'pdftoppm',
    ['-singlefile', '-png', '-r', '96', output, testInfo.outputPath('signature-utilities')],
    { stdio: 'pipe' },
  );
  const storage = await page.evaluate(() => {
    const entries = (value: Storage) => Object.keys(value).map((key) => [key, value.getItem(key)]);
    return JSON.stringify([entries(globalThis.localStorage), entries(globalThis.sessionStorage)]);
  });
  expect(storage).not.toContain('QZ-077');
  expect(requests.join()).not.toContain('QZ-077');
  expect(await readFile(source)).toEqual(original);
  await page.reload();
  await expect(page.getByRole('button', { name: /Visual initials.*Arrow keys move/u })).toHaveCount(
    0,
  );
});
