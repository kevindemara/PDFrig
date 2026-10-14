import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('CONV-005 real local worker preserves every supported character and paginated layout', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const contentRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'POST') contentRequests.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tools');
  await page.getByRole('button', { name: /Text to PDF/u }).click();
  const chooser = page.locator('.utility-bench input[type=file]');
  const build = page.getByRole('button', { name: 'Build text PDF preview' });
  await chooser.setInputFiles({
    name: 'invalid.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from([0xc3, 0x28]),
  });
  await build.click();
  await expect(page.locator('.utility-bench').getByRole('alert')).toContainText('not valid UTF-8');
  await chooser.setInputFiles({
    name: 'non-ascii.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic café 😀'),
  });
  await build.click();
  await expect(page.locator('.utility-bench').getByRole('alert')).toContainText(
    'No characters were replaced',
  );
  const source = resolve('packages/test-corpus/fixtures/plain-text-ascii.txt');
  const before = await readFile(source);
  for (const size of ['letter', 'a4']) {
    await chooser.setInputFiles(source);
    await page.getByLabel('Text PDF page size').selectOption(size);
    await build.click();
    await expect(page.locator('.utility-bench').getByRole('status')).toContainText(
      'Preview ready · 2 pages',
    );
    await expect(page.getByRole('img', { name: 'Rendered text PDF page 1' })).toBeVisible();
    const downloadButton = page.getByRole('button', { name: 'Download reviewed text PDF' });
    await expect(downloadButton).toBeDisabled();
    await page.getByRole('button', { name: 'Next text preview page' }).click();
    await expect(page.locator('.utility-bench').getByRole('status')).toContainText(
      'Preview page 2 of 2',
    );
    await page.getByLabel('I reviewed the text layout, wrapping and pagination.').check();
    await page.getByLabel('Text preview zoom').selectOption('4');
    expect(
      await page
        .getByRole('region', { name: 'Scrollable text PDF preview' })
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const accessibility = await new AxeBuilder({ page })
      .include('.utility-bench')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`text-${size}-compact.png`),
      fullPage: true,
    });
    await page.getByLabel('Text preview zoom').selectOption('1');
    const downloading = page.waitForEvent('download');
    await downloadButton.click();
    const output = testInfo.outputPath(`text-${size}.pdf`);
    await (await downloading).saveAs(output);
    execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', output], { stdio: 'pipe' });
    const python =
      process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
    const prefix =
      process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
    execFileSync(python, [...prefix, 'scripts/verify-text-pdf.py', output, source, size], {
      stdio: 'pipe',
    });
    for (const number of [1, 2]) {
      const rendered = testInfo.outputPath(`text-${size}-page-${number}`);
      execFileSync(
        process.env.PDFMASON_PDFTOPPM_PATH ?? 'pdftoppm',
        ['-f', String(number), '-singlefile', '-r', '72', output, rendered],
        { stdio: 'pipe' },
      );
      const ppm = await readFile(`${rendered}.ppm`);
      const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(ppm.subarray(0, 100).toString('ascii'));
      if (header === null) throw new Error('invalid render');
      const width = Number(header[1]);
      const height = Number(header[2]);
      const pixels = ppm.subarray(Buffer.byteLength(header[0], 'ascii'));
      expect(pixels.byteLength).toBe(width * height * 3);
      let ink = 0;
      let outside = 0;
      for (let index = 0; index < width * height; index += 1)
        if ((pixels[index * 3] ?? 255) < 200) {
          ink += 1;
          const x = index % width;
          const y = Math.floor(index / width);
          if (x < 35 || x > width - 35 || y < 35 || y > height - 35) outside += 1;
        }
      expect(ink).toBeGreaterThan(100);
      expect(outside).toBe(0);
      execFileSync(
        process.env.PDFMASON_PDFTOPPM_PATH ?? 'pdftoppm',
        ['-f', String(number), '-singlefile', '-png', '-r', '72', output, rendered],
        { stdio: 'pipe' },
      );
    }
    await page.getByLabel('Text PDF page size').selectOption(size === 'letter' ? 'a4' : 'letter');
    await expect(downloadButton).toHaveCount(0);
  }
  expect(await readFile(source)).toEqual(before);
  expect(errors).toEqual([]);
  expect(contentRequests).toEqual([]);
});
