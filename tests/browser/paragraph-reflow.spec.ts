import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const replacement = 'a substantially longer introductory passage with natural wrapping';
for (const variant of ['normal', 'crop-rotated', 'graphics-state'])
  test(`EDIT-002 natural paragraph reflow ${variant} previews and exports identical rendered pages`, async ({
    page,
  }, info) => {
    const source = info.outputPath('paragraph.pdf');
    execFileSync(process.execPath, ['scripts/generate-paragraph-reflow.mjs', source, variant], {
      stdio: 'pipe',
    });
    const original = await readFile(source);
    await page.goto('/workspace');
    await expect(page.getByLabel('Open PDF')).toBeEnabled();
    await page.getByLabel('Open PDF').setInputFiles(source);
    await expect(page.locator('.pdf-text-status')).toContainText('Text is selectable');
    await page.locator('.pdf-text-layer').evaluate((element) => {
      const node = [...element.querySelectorAll('span')].find((span) =>
        span.textContent.includes('first line'),
      )?.firstChild;
      if (!node) throw new Error('Missing synthetic paragraph span');
      const start = (node.textContent ?? '').indexOf('first');
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 5);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit existing text' });
    await expect(dialog.getByLabel('Text layout', { exact: true })).toHaveValue('paragraph');
    await expect(dialog.getByLabel('Replacement text')).toHaveValue('first');
    await dialog
      .getByLabel('Replacement text')
      .fill(variant === 'graphics-state' ? 'final' : replacement);
    if (variant !== 'graphics-state')
      await dialog.getByLabel('Paragraph width (pt)', { exact: true }).fill('220');
    await dialog.getByRole('button', { name: 'Build actual PDF preview' }).click();
    await expect(dialog.getByRole('status')).toContainText('no shrinking or squeezing');
    const actualPreview = dialog.getByLabel('Actual exported PDF preview', { exact: true });
    const previewPixels = await actualPreview.evaluate((element) =>
      (element as HTMLCanvasElement).toDataURL(),
    );
    const previewRegion = dialog.getByRole('region', { name: 'Scrollable exported PDF preview' });
    await previewRegion.scrollIntoViewIfNeeded();
    await previewRegion.screenshot({ path: info.outputPath('actual-preview.png') });
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Apply reviewed copy' }).click();
    await page.getByRole('button', { name: 'Select text', exact: true }).click();
    const zoomButton = variant === 'crop-rotated' ? 'Fit full page' : 'Actual size (100%)';
    await page.getByRole('button', { name: zoomButton, exact: true }).click();
    const expectedText = variant === 'graphics-state' ? /final line/u : /substantially\s*longer/u;
    await expect(page.locator('.pdf-text-layer')).toContainText(expectedText);
    const rendered = page.getByLabel('Rendered page 1', { exact: true });
    await expect(rendered).toBeVisible();
    if (variant !== 'crop-rotated')
      await expect
        .poll(() => rendered.evaluate((element) => (element as HTMLCanvasElement).toDataURL()))
        .toBe(previewPixels);
    const beforeExport = await rendered.evaluate((element) =>
      (element as HTMLCanvasElement).toDataURL(),
    );
    await page.getByRole('button', { name: 'Review export', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export completed copy' }).click();
    const output = info.outputPath('reflowed.pdf');
    await (await download).saveAs(output);
    execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', output], { stdio: 'pipe' });
    const report = JSON.parse(
      execFileSync(
        process.env.PDFMASON_PYTHON_PATH ?? 'python',
        ['scripts/verify-paragraph-reflow.py', source, output, variant],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    ) as Record<string, boolean>;
    expect(Object.values(report).every(Boolean)).toBe(true);
    await page.getByLabel('Open PDF').setInputFiles(output);
    await expect(page.locator('.pdf-text-layer')).toContainText(expectedText);
    await page.getByRole('button', { name: zoomButton, exact: true }).click();
    await expect
      .poll(() => rendered.evaluate((element) => (element as HTMLCanvasElement).toDataURL()))
      .toBe(beforeExport);
    expect(await readFile(source)).toEqual(original);
  });

test('EDIT-002 paragraph overflow blocks review without squeezing or applying', async ({
  page,
}, info) => {
  const source = info.outputPath('overflow.pdf');
  execFileSync(process.execPath, ['scripts/generate-paragraph-reflow.mjs', source], {
    stdio: 'pipe',
  });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(source);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Edit existing text', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit existing text' });
  await expect(dialog.getByLabel('Replacement text')).toBeEnabled();
  await dialog.getByLabel('Replacement text').fill('long replacement words '.repeat(30));
  await dialog.getByLabel('Paragraph width (pt)', { exact: true }).fill('100');
  await dialog.getByLabel('Paragraph height (pt)', { exact: true }).fill('25');
  await dialog.getByRole('button', { name: 'Build actual PDF preview' }).click();
  await expect(dialog.getByRole('status')).toContainText('needs more vertical space');
  await expect(dialog.getByRole('checkbox')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Apply reviewed copy' })).toBeDisabled();
});

test('EDIT-002 a cross-line selection reflows and preview controls invalidate review', async ({
  page,
}, info) => {
  const source = info.outputPath('selection.pdf');
  execFileSync(process.execPath, ['scripts/generate-paragraph-reflow.mjs', source], {
    stdio: 'pipe',
  });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(source);
  await expect(page.locator('.pdf-text-status')).toContainText('Text is selectable');
  await page.locator('.pdf-text-layer').evaluate((element) => {
    const spans = [...element.querySelectorAll('span')];
    const first = spans.find((span) => span.textContent.includes('first line'))?.firstChild;
    const second = spans.find((span) => span.textContent.includes('second line'))?.firstChild;
    if (!first || !second) throw new Error('Missing fixture lines');
    const range = document.createRange();
    range.setStart(first, (first.textContent ?? '').indexOf('short'));
    range.setEnd(second, (second.textContent ?? '').indexOf('keeps'));
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit existing text' });
  await expect(dialog.getByLabel('Selected text (words to replace)')).toHaveValue(
    'short paragraph. The second line ',
  );
  await dialog.getByLabel('Replacement text').fill('rewritten paragraph now ');
  await dialog.getByRole('button', { name: 'Build actual PDF preview' }).click();
  await expect(dialog.getByRole('status')).toContainText('no shrinking or squeezing');
  await dialog.getByRole('checkbox').check();
  await dialog.getByLabel('Paragraph width (pt)', { exact: true }).fill('260');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await expect(dialog.getByRole('checkbox')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Build actual PDF preview' }).click();
  await expect(dialog.getByRole('status')).toContainText('no shrinking or squeezing');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Apply reviewed copy' }).click();
  await page.getByRole('button', { name: 'Select text', exact: true }).click();
  await expect(page.locator('.pdf-text-layer')).toContainText(/rewritten\s*paragraph/u);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.pdf-text-layer')).toContainText('short paragraph');
  await expect(page.locator('.pdf-text-layer')).not.toContainText(/rewritten\s*paragraph/u);
});
