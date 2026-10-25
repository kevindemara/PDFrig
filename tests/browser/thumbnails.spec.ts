import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const assertBoundedRail = async (page: Page) => {
  // The reference viewport fits fewer than ten rows; allow overscan and two pins.
  expect(await page.locator('.page-thumbnails__row').count()).toBeLessThanOrEqual(16);
  expect(await page.locator('.page-thumbnails canvas').count()).toBeLessThanOrEqual(16);
  await expect(page.locator('.page-thumbnails button[tabindex="0"]')).toHaveCount(1);
};

test('VIEW-004 virtualizes 500 mixed pages and preserves keyboard ordering/export fidelity', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));
  // Includes a real 500-page worker export and independent per-page verification.
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/many-pages-500.pdf');
  const before = await readFile(source);
  await page.getByLabel('Open PDF').setInputFiles(source);
  await expect(page.locator('.status-bar')).toContainText('500 pages');
  const list = page.getByRole('list', { name: 'Page thumbnails' });
  const first = list.getByRole('button', { name: 'Page 1', exact: true });
  await expect(first).toBeVisible();
  await expect(first.locator('[data-preview]')).toHaveAttribute('data-preview', 'ready');
  await assertBoundedRail(page);
  expect(await page.locator('.page-thumbnails').evaluate((rail) => rail.clientHeight)).toBeLessThan(
    900,
  );
  await first.focus();
  await first.press('End');
  const last = list.getByRole('button', { name: 'Page 500', exact: true });
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute('aria-current', 'page');
  await expect(last.locator('[data-preview]')).toHaveAttribute('data-preview', 'ready');
  await expect(page.getByLabel('Rendered page 500')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(last.locator('..').locator('..')).toHaveAttribute('aria-setsize', '500');
  await assertBoundedRail(page);

  // Scroll away from a focused row: it remains mounted, with its identity intact.
  await page.locator('.page-thumbnails').evaluate((rail) => {
    rail.scrollTop = 0;
  });
  await expect(last).toBeFocused();
  await expect(first).toBeVisible();
  await assertBoundedRail(page);
  await last.press('Home');
  await expect(first).toBeFocused();
  for (let index = 0; index < 12; index += 1) await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('button', { name: 'Page 13', exact: true })).toBeFocused();
  await page.keyboard.press('PageDown');
  await assertBoundedRail(page);
  await page.setViewportSize({ width: 1440, height: 650 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await page.keyboard.press('End');
  await expect(last).toBeFocused();
  await expect(last).toBeVisible();
  await assertBoundedRail(page);
  expect(
    await page.locator('.page-thumbnails').evaluate((rail) => rail.scrollWidth <= rail.clientWidth),
  ).toBe(true);
  expect(
    await page.getByLabel('Document status').evaluate((element) => {
      const bar = element.closest('.app-topbar');
      return (
        bar !== null && element.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom
      );
    }),
  ).toBe(true);
  expect(
    await page
      .locator('.tool-rail button')
      .evaluateAll((buttons) =>
        buttons.every((button) => button.scrollWidth <= button.clientWidth),
      ),
  ).toBe(true);
  await page.locator('.tool-rail').getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add a visual signature' })).toBeVisible();
  await page.getByRole('button', { name: 'Close visual signature dialog' }).click();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.locator('.tool-rail').getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(last).toHaveAttribute('aria-current', 'page');
  await last.focus();
  await expect(last).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await assertBoundedRail(page);
  await page.screenshot({ path: testInfo.outputPath('thumbnail-text-scale.png') });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  const properties = page.locator('.properties-panel');
  await properties.getByRole('button', { name: 'Move up', exact: true }).click();
  const moved = list.getByRole('button', { name: 'Page 499', exact: true });
  await expect(moved).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.viewer-toolbar')).toContainText('499 / 500');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(last).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(moved).toHaveAttribute('aria-current', 'page');
  await properties.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await expect(moved.locator('[data-preview]')).toHaveAttribute('data-preview', 'ready');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await properties.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.status-bar')).toContainText('499 pages');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.status-bar')).toContainText('500 pages');
  await expect(moved).toHaveAttribute('aria-current', 'page');
  await assertBoundedRail(page);
  expect((await new AxeBuilder({ page }).include('.context-panel').analyze()).violations).toEqual(
    [],
  );
  await page.screenshot({ path: testInfo.outputPath('thumbnail-large-document.png') });

  await page.getByRole('button', { name: 'Review export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('reordered-500.pdf');
  await (await download).saveAs(output);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const prefix =
    process.platform === 'win32' && process.env.PDFMASON_PYTHON_PATH === undefined ? ['-3'] : [];
  execFileSync(
    python,
    [
      ...prefix,
      '-c',
      'import sys; from pypdf import PdfReader; a=PdfReader(sys.argv[1],strict=True); b=PdfReader(sys.argv[2],strict=True); order=list(range(498))+[499,498]; assert len(a.pages)==len(b.pages)==500; assert all(a.pages[i].extract_text()==b.pages[j].extract_text() and list(a.pages[i].mediabox)==list(b.pages[j].mediabox) and a.pages[i].rotation==b.pages[j].rotation for j,i in enumerate(order))',
      source,
      output,
    ],
    { stdio: 'pipe' },
  );
  const render = (file: string, pageNumber: number) =>
    execFileSync('pdftoppm', ['-singlefile', '-f', String(pageNumber), '-r', '36', file], {
      maxBuffer: 4 * 1024 * 1024,
      stdio: 'pipe',
    });
  expect(render(output, 499)).toEqual(render(source, 500));
  expect(render(output, 500)).toEqual(render(source, 499));
  execFileSync(
    'pdftoppm',
    [
      '-png',
      '-singlefile',
      '-f',
      '499',
      '-r',
      '72',
      output,
      testInfo.outputPath('thumbnail-exported-render'),
    ],
    { stdio: 'pipe' },
  );
  expect(await readFile(source)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('VIEW-004 preserves pointer reorder across a virtual scroll and replaces sources safely', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/many-pages-25.pdf'));
  await expect(page.locator('.status-bar')).toContainText('25 pages');
  const list = page.getByRole('list', { name: 'Page thumbnails' });
  const first = list.getByRole('button', { name: 'Page 1', exact: true });
  await expect(first).toBeVisible();
  const originalId = await first.locator('..').locator('..').getAttribute('data-page-id');
  if (originalId === null) throw new Error('Missing stable page identity');
  await first.dragTo(list.getByRole('button', { name: 'Page 3', exact: true }));
  await expect(
    list.getByRole('button', { name: 'Page 3', exact: true }).locator('..').locator('..'),
  ).toHaveAttribute('data-page-id', originalId);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await first.locator('..').locator('..').dispatchEvent('dragstart');
  // Event state carries the stable source ID after its original row unmounts.
  await list.getByRole('button', { name: 'Page 1', exact: true }).focus();
  await page.keyboard.press('End');
  const last = list.getByRole('button', { name: 'Page 25', exact: true });
  await expect(last).toBeVisible();
  await last.locator('..').locator('..').dispatchEvent('drop');
  await expect(last.locator('..').locator('..')).toHaveAttribute('data-page-id', originalId);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await last.press('Home');
  await expect(first.locator('..').locator('..')).toHaveAttribute('data-page-id', originalId);
  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/mixed-page-sizes.pdf'));
  const confirmation = page.getByRole('alertdialog', { name: 'Discard unsaved work?' });
  await expect(confirmation).toBeVisible();
  await expect(page.locator('.status-bar')).toContainText('25 pages');
  await confirmation.getByRole('button', { name: 'Discard and continue', exact: true }).click();
  await expect(page.locator('.status-bar')).toContainText('3 pages');
  await expect(list.getByRole('button')).toHaveCount(3);
  await expect(list.getByRole('button', { name: 'Page 1', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.screenshot({ path: testInfo.outputPath('thumbnail-replaced-source.png') });
  expect(pageErrors).toEqual([]);
});
