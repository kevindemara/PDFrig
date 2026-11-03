import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import path from 'node:path';

test('VIEW-004 page jumping validates working-copy numbers and protects typing and dialogs', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/workspace');
  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/many-pages-500.pdf'));
  const jump = page.getByRole('textbox', { name: 'Go to page', exact: true });
  await expect(jump).toHaveValue('1');
  for (const value of ['', '0', '501', '1.5', '-2', '2e1']) {
    await jump.fill(value);
    await jump.press('Enter');
    await expect(page.locator('.page-jump').getByRole('alert')).toContainText(
      'Enter a page from 1 to 500.',
    );
    await expect(page.getByRole('heading', { name: 'Page 1', exact: true })).toBeVisible();
  }
  await jump.press('Escape');
  await expect(jump).toHaveValue('1');
  await jump.fill('42');
  await expect(page.getByRole('heading', { name: 'Page 1', exact: true })).toBeVisible();
  await jump.press('Enter');
  await expect(jump).toHaveValue('42');
  await expect(page.getByRole('heading', { name: 'Page 42', exact: true })).toBeVisible();
  await jump.focus();
  await jump.press('PageDown');
  await expect(jump).toHaveValue('42');
  await page.getByRole('button', { name: 'Fit full page' }).focus();
  await page.keyboard.press('PageDown');
  await expect(jump).toHaveValue('43');
  await page.keyboard.press('PageUp');
  await expect(jump).toHaveValue('42');
  await jump.fill('500');
  await page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await page.getByRole('button', { name: 'Fit full page' }).focus();
  await page.keyboard.press('PageDown');
  await expect(jump).toHaveValue('500');
  await jump.fill('1');
  await jump.press('Enter');
  await page.getByRole('button', { name: 'Fit full page' }).focus();
  await page.keyboard.press('PageUp');
  await expect(jump).toHaveValue('1');
  await page.getByRole('button', { name: 'Review export' }).click();
  await expect(page.getByRole('dialog', { name: 'Review your completed copy' })).toBeVisible();
  await page.keyboard.press('PageDown');
  await expect(jump).toHaveValue('1');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const a11y = await new AxeBuilder({ page })
    .include('.viewer-toolbar')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('page-jump.png') });
  expect(errors).toEqual([]);
});
