import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('SEC-001/002 real worker refuses unsafe encryption and preserves an authorized round trip', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const posts: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tools');
  await page.getByRole('button', { name: /Protect \/ unlock/u }).click();
  const bench = page.locator('.utility-bench');
  const chooser = bench.locator('input[type=file]');
  const create = page.getByRole('button', { name: 'Create export' });
  const download = page.getByRole('button', { name: 'Download new copy' });
  const password = page.getByLabel('New open password');
  await chooser.setInputFiles(
    resolve('packages/test-corpus/fixtures/compression-preservation.pdf'),
  );
  await password.fill('synthetic-open-password');
  await create.click();
  await expect(bench.getByRole('status')).toContainText('string layout');
  await expect(password).toHaveValue('');
  await expect(download).toHaveCount(0);
  const source = resolve('packages/test-corpus/fixtures/smoke-one-page.pdf');
  const original = await readFile(source);
  await chooser.setInputFiles(source);
  await password.fill('é'.repeat(12));
  await create.click();
  await expect(bench.getByRole('status')).toContainText('printable ASCII');
  await expect(password).toHaveValue('');
  await expect(download).toHaveCount(0);
  await password.fill('synthetic-open-password');
  await create.click();
  await expect(bench.getByRole('status')).toContainText('Export ready');
  await expect(password).toHaveValue('');
  const protecting = page.waitForEvent('download');
  await download.click();
  const encryptedPath = testInfo.outputPath('protected.pdf');
  await (await protecting).saveAs(encryptedPath);
  const qpdf = process.env.PDFMASON_QPDF_PATH ?? 'qpdf';
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const prefix =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  const verify = (output: string, mode: 'protect' | 'unlocked') => {
    execFileSync(
      qpdf,
      [...(mode === 'protect' ? ['--password=synthetic-open-password'] : []), '--check', output],
      { stdio: 'pipe' },
    );
    execFileSync(
      python,
      [
        ...prefix,
        'scripts/verify-pdf-permissions.py',
        source,
        output,
        'high',
        'true',
        'true',
        'true',
        'true',
        'true',
        'false',
        mode,
      ],
      { stdio: 'pipe' },
    );
  };
  verify(encryptedPath, 'protect');
  await password.fill('synthetic-new-password');
  await expect(download).toHaveCount(0);
  await page.getByRole('button', { name: 'Unlock a copy' }).click();
  const currentPassword = page.getByLabel('Current open password');
  await expect(currentPassword).toHaveValue('');
  const authorization = page.getByRole('checkbox', { name: /I am authorized to remove/u });
  await authorization.check();
  await chooser.setInputFiles(encryptedPath);
  await expect(authorization).not.toBeChecked();
  await currentPassword.fill('synthetic-wrong-password');
  await expect(create).toBeDisabled();
  await authorization.check();
  await create.click();
  await expect(bench.getByRole('status')).toContainText('did not open the PDF');
  await expect(currentPassword).toHaveValue('');
  await expect(download).toHaveCount(0);
  await currentPassword.fill('synthetic-open-password');
  await create.click();
  await expect(bench.getByRole('status')).toContainText('Export ready');
  await expect(currentPassword).toHaveValue('');
  const unlocking = page.waitForEvent('download');
  await download.click();
  const plainPath = testInfo.outputPath('unlocked.pdf');
  await (await unlocking).saveAs(plainPath);
  verify(plainPath, 'unlocked');
  const renderer = process.env.PDFMASON_PDFTOPPM_PATH ?? 'pdftoppm';
  const before = testInfo.outputPath('original');
  const after = testInfo.outputPath('unlocked');
  for (const [pdf, image] of [
    [source, before],
    [plainPath, after],
  ] as const) {
    execFileSync(renderer, ['-singlefile', '-r', '72', pdf, image], { stdio: 'pipe' });
  }
  expect(await readFile(`${after}.ppm`)).toEqual(await readFile(`${before}.ppm`));
  expect(
    (
      await new AxeBuilder({ page })
        .include('.utility-bench')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('unlock-compact.png'), fullPage: true });
  await authorization.uncheck();
  await expect(download).toHaveCount(0);
  expect(await readFile(source)).toEqual(original);
  expect(errors).toEqual([]);
  expect(posts).toEqual([]);
});
