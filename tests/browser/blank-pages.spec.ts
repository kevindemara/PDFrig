import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

test('CREATE-001 multi-page blank output stays empty and count changes invalidate downloads', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tools');
  await page.getByRole('button', { name: /Create blank PDF/u }).click();
  const count = page.getByLabel('Number of pages');
  const create = page.getByRole('button', { name: 'Create export' });
  for (const value of ['', '0', '-1', '1.5', '501']) {
    await count.fill(value);
    await expect(create).toBeDisabled();
    await expect(page.locator('.utility-bench').getByRole('alert')).toContainText(
      'whole page count from 1 to 500',
    );
  }
  await count.fill('500');
  await expect(create).toBeEnabled();
  await count.fill('3');
  await page.getByLabel('Page size').selectOption('a4');
  await page.getByLabel('Orientation').selectOption('landscape');
  await page.getByRole('combobox', { name: /Content-safe margin/u }).selectOption('72');
  await expect(page.getByLabel('Blank page preview')).toContainText('3 blank pages');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .include('.utility-bench')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('blank-pages-compact.png'), fullPage: true });
  await create.click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  await expect(page.getByText(/3 blank pages · A4/u)).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const download = await downloading;
  const output = testInfo.outputPath('three-blank-pages.pdf');
  await download.saveAs(output);
  const qpdf = process.env.PDFMASON_QPDF_PATH ?? 'qpdf';
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const prefix =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  execFileSync(
    python,
    [
      ...prefix,
      '-c',
      'import sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1],strict=True); assert len(r.pages)==3; close=lambda a,b: all(abs(float(x)-y)<0.02 for x,y in zip(a,b)); assert all(close(p.mediabox,(0,0,841.89,595.28)) and close(p.cropbox,p.mediabox) and close(p.artbox,(72,72,769.89,523.28)) and p.get_contents() is None and (p.extract_text() or "")=="" and "/Annots" not in p for p in r.pages); assert not r.is_encrypted; assert not r.metadata or all(k not in r.metadata for k in ("/CreationDate","/ModDate"))',
      output,
    ],
    { stdio: 'pipe' },
  );
  const pdftoppm = process.env.PDFMASON_PDFTOPPM_PATH ?? 'pdftoppm';
  for (const pageNumber of [1, 2, 3]) {
    const rendered = testInfo.outputPath(`blank-render-${pageNumber}`);
    execFileSync(
      pdftoppm,
      ['-f', String(pageNumber), '-singlefile', '-r', '72', output, rendered],
      { stdio: 'pipe' },
    );
    const ppm = await readFile(`${rendered}.ppm`);
    const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(ppm.subarray(0, 100).toString('ascii'));
    if (header === null) throw new Error('Invalid independent blank-page render');
    const pixels = ppm.subarray(Buffer.byteLength(header[0], 'ascii'));
    expect(pixels.byteLength).toBe(Number(header[1]) * Number(header[2]) * 3);
    expect(pixels.every((value) => value === 255)).toBe(true);
  }
  execFileSync(
    pdftoppm,
    ['-f', '3', '-singlefile', '-png', '-r', '72', output, testInfo.outputPath('blank-page-3')],
    { stdio: 'pipe' },
  );
  await count.fill('2');
  await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Settings changed');
  await expect(create).toBeEnabled();
  expect(pageErrors).toEqual([]);
});
