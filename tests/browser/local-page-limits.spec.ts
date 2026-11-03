import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const python = process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
const prefix = process.platform === 'win32' && !process.env.PDFMASON_PYTHON_PATH ? ['-3'] : [];
const runPython = (code: string, ...args: string[]) =>
  execFileSync(python, [...prefix, '-c', code, ...args], { stdio: 'pipe' });
const createPdf = (output: string, count: number) =>
  runPython(
    'import sys; from pypdf import PdfReader,PdfWriter; r=PdfReader(sys.argv[1]); w=PdfWriter(); [w.add_page(r.pages[i%len(r.pages)]) for i in range(int(sys.argv[3]))]; w.write(sys.argv[2])',
    path.resolve('packages/test-corpus/fixtures/many-pages-500.pdf'),
    output,
    String(count),
  );

test('VIEW-001/004 accepts old and new inclusive boundaries and explains an oversized replacement', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.goto('/workspace');
  for (const count of [499, 500, 501, 999, 1000]) {
    const source = info.outputPath(`synthetic-${count}.pdf`);
    createPdf(source, count);
    await expect(page.getByLabel('Open PDF')).toBeEnabled();
    await page.getByLabel('Open PDF').setInputFiles(source);
    await expect(page.locator('.status-bar')).toContainText(`${count} pages`);
    await expect(page.getByLabel('Rendered page 1')).toBeVisible();
    expect(await page.locator('.page-thumbnails canvas').count()).toBeLessThanOrEqual(16);
  }
  const oversized = info.outputPath('synthetic-1001.pdf');
  createPdf(oversized, 1001);
  await page.getByLabel('Open PDF').setInputFiles(oversized);
  await expect(page.locator('.workspace-alert')).toContainText(
    'This PDF contains 1,001 pages. The local workspace supports up to 1,000 pages.',
  );
  await expect(page.locator('.status-bar')).toContainText('1000 pages');
  await expect(page.getByLabel('Rendered page 1')).toBeVisible();
});

test('VIEW-004/ORG-001 navigates and exports 1000 mixed pages with bounded thumbnails and independent fidelity', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const source = info.outputPath('synthetic-1000.pdf');
  createPdf(source, 1000);
  const before = await readFile(source);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(source);
  const jump = page.getByRole('textbox', { name: 'Go to page', exact: true });
  await expect(jump).toHaveValue('1');
  await jump.fill('1000');
  await jump.press('Enter');
  await expect(page.getByLabel('Rendered page 1000')).toBeVisible();
  const visibleNumber = await jump.evaluate((element) => {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('Text measurement unavailable');
    context.font = style.font;
    const horizontalChrome = [
      style.paddingLeft,
      style.paddingRight,
      style.borderLeftWidth,
      style.borderRightWidth,
    ].reduce((total, value) => total + parseFloat(value), 0);
    return (
      context.measureText((element as HTMLInputElement).value).width + horizontalChrome <=
      element.getBoundingClientRect().width + 0.5
    );
  });
  expect(visibleNumber).toBe(true);
  expect(await page.locator('.page-thumbnails canvas').count()).toBeLessThanOrEqual(16);
  await page
    .locator('.properties-panel')
    .getByRole('button', { name: 'Move up', exact: true })
    .click();
  await expect(jump).toHaveValue('999');
  await page.getByRole('button', { name: 'Review export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const output = info.outputPath('reordered-1000.pdf');
  await (await download).saveAs(output);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  runPython(
    'import sys; from pypdf import PdfReader; a=PdfReader(sys.argv[1],strict=True); b=PdfReader(sys.argv[2],strict=True); order=list(range(998))+[999,998]; assert len(a.pages)==len(b.pages)==1000; assert all(a.pages[i].extract_text()==b.pages[j].extract_text() and list(a.pages[i].mediabox)==list(b.pages[j].mediabox) and a.pages[i].rotation==b.pages[j].rotation for j,i in enumerate(order))',
    source,
    output,
  );
  const render = (file: string, number: number) =>
    execFileSync('pdftoppm', ['-singlefile', '-f', String(number), '-r', '36', file], {
      maxBuffer: 4 * 1024 * 1024,
      stdio: 'pipe',
    });
  expect(render(output, 999)).toEqual(render(source, 1000));
  expect(render(output, 1000)).toEqual(render(source, 999));
  expect(await readFile(source)).toEqual(before);
  expect(errors).toEqual([]);
});
