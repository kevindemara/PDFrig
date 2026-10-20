import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  // Match the Windows plugin's async override; navigation must use in-app UI instead.
  await page.addInitScript(() =>
    Object.defineProperty(window, 'confirm', {
      value: () => Promise.reject(new Error('Unexpected native confirmation')),
    }),
  );
});

const openPdf = async (page: Page) => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/tagged-bookmarks.pdf'));
  await expect(page.getByRole('region', { name: 'Selectable PDF text' })).toContainText(
    'Tagged synthetic paragraph 1',
  );
};
const editPdf = async (page: Page) => {
  await openPdf(page);
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'tagged-field', exact: true })
    .fill('Keep this unsaved value');
  await expect(page.getByLabel('Document status')).toContainText('Changes not exported');
};

test('VIEW-001 All tools is visible, keyboard-accessible and routes clean workspaces without a warning', async ({
  page,
}, testInfo) => {
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.goto('/workspace');
  for (const width of [1440, 1024, 800, 760, 390]) {
    await page.setViewportSize({ width, height: 850 });
    const tools = page.getByRole('button', { name: 'All tools', exact: true });
    await expect(tools).toBeVisible();
    const bounds = await tools.boundingBox();
    expect(bounds).not.toBeNull();
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: testInfo.outputPath(`all-tools-${width}.png`) });
  }
  const tools = page.getByRole('button', { name: 'All tools', exact: true });
  await tools.focus();
  await expect(tools).toBeFocused();
  await tools.press('Enter');
  await expect(page).toHaveURL(/\/tools$/u);
  expect(dialogs).toEqual([]);
  await openPdf(page);
  await page.getByRole('button', { name: 'All tools', exact: true }).click();
  await expect(page).toHaveURL(/\/tools$/u);
  expect(dialogs).toEqual([]);
});

test('VIEW-001 guides still warn after PDF export and unapplied redaction marks are protected', async ({
  page,
}) => {
  await openPdf(page);
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  await page.getByRole('combobox', { name: 'Measurement shape' }).selectOption('rectangle');
  await page.getByRole('button', { name: 'Review export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  await download;
  await expect(page.getByRole('dialog', { name: 'Review your completed copy' })).toHaveCount(0);
  await page.getByRole('button', { name: 'All tools', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('session-only measurement guides');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/u);
  await expect(page.getByRole('combobox', { name: 'Measurement shape' })).toHaveValue('rectangle');

  // A fresh page removes the guide and isolates the separate unapplied-removal path.
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await page.getByRole('button', { name: 'Redact beta', exact: true }).click();
  await page.getByRole('button', { name: 'Mark page centre', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Clear 1 removal mark', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'All tools', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('unapplied redaction marks');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/u);
  await expect(
    page.getByRole('button', { name: 'Clear 1 removal mark', exact: true }),
  ).toBeEnabled();
});

test('VIEW-001 cancelling All tools or logo navigation preserves unsaved form edits and undo state', async ({
  page,
}) => {
  await editPdf(page);
  for (const trigger of [
    page.getByRole('button', { name: 'All tools', exact: true }),
    page.getByRole('link', { name: 'Back to PDFrig home' }),
  ]) {
    await trigger.focus();
    await trigger.press('Enter');
    const confirmation = page.getByRole('alertdialog', { name: 'Discard unsaved work?' });
    await expect(confirmation).toContainText('Choose Cancel to stay and export');
    const cancel = confirmation.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeFocused();
    const a11y = await new AxeBuilder({ page })
      .include('[role="alertdialog"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(a11y.violations).toEqual([]);
    await cancel.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(page).toHaveURL(/\/workspace$/u);
    await expect(page.getByRole('textbox', { name: 'tagged-field', exact: true })).toHaveValue(
      'Keep this unsaved value',
    );
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    await expect(trigger).toBeFocused();
  }
  const a11y = await new AxeBuilder({ page })
    .include('.app-topbar')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(a11y.violations).toEqual([]);
});

test('VIEW-001 accepting the warning leaves for All tools', async ({ page }) => {
  await editPdf(page);
  await page.getByRole('button', { name: 'All tools', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText(
    'Your original PDF and already exported files will not change',
  );
  await page.getByRole('button', { name: 'Discard and continue', exact: true }).click();
  await expect(page).toHaveURL(/\/tools$/u);
});

test('VIEW-001 a successful export clears the edit warning', async ({ page }) => {
  await editPdf(page);
  await page.getByRole('button', { name: 'Review export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  await download;
  await expect(page.getByRole('dialog', { name: 'Review your completed copy' })).toHaveCount(0);
  await expect(page.getByLabel('Document status')).toContainText('Original unchanged');
  let warned = false;
  page.on('dialog', async (dialog) => {
    warned = true;
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'All tools', exact: true }).click();
  await expect(page).toHaveURL(/\/tools$/u);
  expect(warned).toBe(false);
});

test('VIEW-001 opening another PDF also awaits explicit discard and cancellation preserves work', async ({
  page,
}) => {
  await editPdf(page);
  const replacement = path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf');
  await page.getByLabel('Open PDF').setInputFiles(replacement);
  await expect(page.getByRole('alertdialog')).toContainText(
    'Starting another PDF clears working changes',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'tagged-field', exact: true })).toHaveValue(
    'Keep this unsaved value',
  );
  await page.getByLabel('Open PDF').setInputFiles(replacement);
  await page.getByRole('button', { name: 'Discard and continue', exact: true }).click();
  await expect(page.getByLabel('Document status')).toContainText('smoke-one-page.pdf');
});
