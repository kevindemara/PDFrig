import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';

const fixture = (name: string) => path.resolve('packages/test-corpus/fixtures', name);

test('VIEW-001 dismisses and restores notices without removing export disclosures or source ownership', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('BROWSER_CONSOLE_ERROR');
  });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(fixture('tagged-bookmarks.pdf'));
  await expect(page.locator('.workspace-warning')).toContainText('Editing available');
  const dismiss = page.getByRole('button', { name: 'Dismiss document notice' });
  await dismiss.focus();
  await dismiss.press('Enter');
  await expect(page.locator('.workspace-warning')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review export' })).toBeEnabled();
  await page.getByRole('button', { name: 'Review export' }).click();
  const review = page.getByRole('dialog', { name: 'Review your completed copy' });
  await expect(review).toContainText('Added content is not tagged');
  await expect(review.getByRole('radio', { name: 'Flatten filled fields' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close export dialog' }).click();
  await page.getByRole('button', { name: 'Show document notice' }).click();
  await expect(page.locator('.workspace-warning')).toContainText('Existing tags and bookmarks');
  const accessibility = await new AxeBuilder({ page })
    .include('.canvas-workspace')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await dismiss.click();
  await page.getByLabel('Open PDF').setInputFiles(fixture('tagged-bookmarks.pdf'));
  await expect(page.locator('.workspace-warning')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Selectable PDF text' })).toContainText(
    'Tagged synthetic paragraph 1',
  );
  // Screenshot caret hiding mutates input styles and can race streamed hydration.
  // Keep the real caret; do not suppress browser errors to make capture pass.
  await page.screenshot({ caret: 'initial', path: testInfo.outputPath('workspace-notice.png') });
  await page.goto('/tools');
  await expect(page.locator('#utility-title')).toBeVisible();
  await expect(page.locator('.utility-bench')).toBeEnabled();
  await page.screenshot({ caret: 'initial', path: testInfo.outputPath('local-tools.png') });
  expect(errors).toEqual([]);
});

test('SEC-007 dismissing a signature notice never grants editing permission', async ({ page }) => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(fixture('signature-field-empty.pdf'));
  await expect(page.getByRole('button', { name: 'Continue editing a new copy' })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss document notice' }).click();
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();
  await page.getByRole('button', { name: 'Show document notice' }).click();
  await expect(page.getByRole('button', { name: 'Continue editing a new copy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
});
