import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
for (const [mode, replacement] of [['positioned', 'EDIT']] as const) {
  test(`EDIT-002 ${mode} selected word becomes ${replacement} with preserved surroundings`, async ({
    page,
  }, info) => {
    const source = info.outputPath('fragmented.pdf');
    execFileSync(process.execPath, ['scripts/generate-source-text-fragments.mjs', source, mode], {
      stdio: 'pipe',
    });
    const before = await readFile(source);
    await page.goto('/workspace');
    await expect(page.getByLabel('Open PDF')).toBeEnabled();
    await page.getByLabel('Open PDF').setInputFiles(source);
    await expect(page.locator('.pdf-text-status')).toContainText('Text is selectable');
    await page.locator('.pdf-text-layer').evaluate((element) => {
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const text = nodes.map((node) => node.textContent).join('');
      const first = text.indexOf('SOURCE'),
        start = text.indexOf('SOURCE', first + 6);
      if (start < 0) throw new Error('Missing synthetic second word');
      const range = document.createRange();
      let offset = 0;
      for (const node of nodes) {
        const length = node.textContent.length;
        if (start >= offset && start < offset + length) range.setStart(node, start - offset);
        if (start + 6 > offset && start + 6 <= offset + length) {
          range.setEnd(node, start + 6 - offset);
          break;
        }
        offset += length;
      }
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await expect(
      page.getByRole('button', { name: 'Edit selected text', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit existing text' });
    await expect(dialog.getByLabel('Replacement text')).toHaveValue('SOURCE');
    await expect(
      dialog
        .getByRole('combobox', { name: 'Source line (context)', exact: true })
        .locator('option:checked'),
    ).toHaveText('SECOND SOURCE AFTER');
    expect(
      await dialog
        .getByRole('combobox', { name: 'Source line (context)', exact: true })
        .locator('option')
        .count(),
    ).toBe(4);
    await dialog.getByLabel('Text layout', { exact: true }).selectOption('inline');
    await dialog.getByLabel('Replacement text').fill(replacement);
    await dialog.getByRole('button', { name: 'Build actual PDF preview' }).click();
    await expect(dialog.getByRole('status')).toContainText('actual exported-PDF preview');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Apply reviewed copy' }).click();
    await page.getByRole('button', { name: 'Review export', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export completed copy' }).click();
    const output = info.outputPath('selected-edit.pdf');
    await (await download).saveAs(output);
    execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', output], { stdio: 'pipe' });
    const report = JSON.parse(
      execFileSync(
        process.env.PDFMASON_PYTHON_PATH ?? 'python',
        ['scripts/verify-fragmented-text.py', source, output, replacement],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    ) as Record<string, boolean>;
    expect(report).toEqual({
      selectionOnly: true,
      fontAndPlacementRetained: true,
      unrelatedPixelsEqual: true,
    });
    expect((await readFile(source)).equals(before)).toBe(true);
  });
}

test('EDIT-002 snapshots the final live selection and explains preview/review gating', async ({
  page,
}, info) => {
  const source = info.outputPath('selection-race.pdf');
  execFileSync(process.execPath, ['scripts/generate-source-text-fragments.mjs', source], {
    stdio: 'pipe',
  });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(source);
  await expect(page.locator('.pdf-text-status')).toContainText('Text is selectable');
  // Capture an intermediate drag; then finish and open in the same event turn,
  // before selectionchange/React state have delivered the last character.
  await page.locator('.pdf-text-layer').evaluate((element) => {
    const node = [...element.querySelectorAll('span')].find((span) =>
      span.textContent.includes('FIRST SOURCE'),
    )?.firstChild;
    if (!node) throw new Error('Missing synthetic source span');
    const text = node.textContent ?? '',
      start = text.indexOf('SOURCE');
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 5);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  const edit = page.getByRole('button', { name: 'Edit selected text', exact: true });
  await expect(edit).toBeEnabled();
  await edit.evaluate((button) => {
    const selection = document.getSelection(),
      range = selection?.getRangeAt(0);
    if (!range || !selection) throw new Error('Missing synthetic selection');
    range.setEnd(range.endContainer, range.endOffset + 1);
    selection.removeAllRanges();
    selection.addRange(range);
    (button as HTMLButtonElement).click();
  });
  const dialog = page.getByRole('dialog', { name: 'Edit existing text' });
  await expect(dialog.getByLabel('Selected text (words to replace)')).toHaveValue('SOURCE');
  await expect(dialog.getByLabel('Replacement text')).toHaveValue('SOURCE');
  await expect(dialog.getByRole('status')).toContainText('Build the PDF preview');
  await expect(dialog.getByRole('checkbox')).toBeDisabled();
  await expect(dialog.getByRole('region', { name: 'Scrollable exported PDF preview' })).toHaveCount(
    0,
  );
  await dialog.getByLabel('Replacement text').fill('MUCH LONGER REPLACEMENT');
  await dialog.getByLabel('Text layout', { exact: true }).selectOption('inline');
  await dialog.getByRole('button', { name: 'Build actual PDF preview' }).click();
  await expect(dialog.getByRole('status')).toContainText('The replacement is wider in this font');
  await expect(dialog.getByRole('checkbox')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Apply reviewed copy' })).toBeDisabled();
  await dialog.getByLabel('Replacement text').fill('EDIT');
  await dialog.getByRole('button', { name: 'Build actual PDF preview' }).click();
  await expect(dialog.getByRole('status')).toContainText('actual exported-PDF preview');
  await expect(dialog.getByRole('checkbox')).toBeEnabled();
  await dialog.getByRole('checkbox').check();
  await expect(dialog.getByRole('button', { name: 'Apply reviewed copy' })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('review-ready.png') });
  await dialog.getByLabel('Replacement text').fill('NEW');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await expect(dialog.getByRole('checkbox')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Apply reviewed copy' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
