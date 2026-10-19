import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { modifyPdfGeometry } from '../../packages/pdf-engine/dist/index.js';

const assertFullPage = async (page: Page) => {
  await expect
    .poll(async () =>
      page.locator('.pdf-page-canvas').evaluate((element) => {
        const pageBounds = element.getBoundingClientRect();
        const slot = element.closest('.page-pasteboard')?.getBoundingClientRect();
        return (
          slot !== undefined &&
          pageBounds.width > 0 &&
          pageBounds.height > 0 &&
          pageBounds.left >= slot.left &&
          pageBounds.top >= slot.top &&
          pageBounds.right <= slot.right &&
          pageBounds.bottom <= slot.bottom
        );
      }),
    )
    .toBe(true);
};

test('VIEW-003 full-page fit uses the available viewport and follows resize/panel/rotation changes', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let analyticsRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/beta/analytics') analyticsRequests += 1;
  });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Privacy choices', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Optional, content-free analytics' })).toHaveCount(
    0,
  );
  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  const privacy = page.getByRole('button', { name: 'Privacy choices', exact: true });
  await privacy.click();
  await page.getByRole('button', { name: 'Close privacy choices' }).click();
  await expect(privacy).toBeFocused();
  expect(analyticsRequests).toBe(0);
  await expect(page.getByRole('button', { name: 'Fit full page' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await assertFullPage(page);
  const outerPadding = await page
    .locator('.canvas-workspace')
    .evaluate((element) => parseFloat(getComputedStyle(element).paddingTop));
  const innerPadding = await page
    .locator('.page-pasteboard')
    .evaluate((element) => parseFloat(getComputedStyle(element).paddingTop));
  expect(outerPadding + innerPadding).toBeLessThanOrEqual(16);
  await page.getByRole('button', { name: 'Collapse tools', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse tool options', exact: true }).click();
  await assertFullPage(page);
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await assertFullPage(page);
  await page.setViewportSize({ width: 1100, height: 650 });
  await assertFullPage(page);
  await page.screenshot({ path: testInfo.outputPath('measured-full-page-fit.png') });
  await page.getByRole('button', { name: 'Actual size (100%)' }).click();
  await expect(page.getByRole('button', { name: 'Fit full page' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(
    page
      .getByRole('toolbar', { name: 'Document navigation' })
      .getByText('100%', { exact: true })
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fit full page' }).click();
  await assertFullPage(page);
});

test('VIEW-003 very tall synthetic pages fit below the old zoom floor and retain manual detail zoom', async ({
  page,
}, testInfo) => {
  const source = new Uint8Array(
    await readFile(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf')),
  );
  const tall = await modifyPdfGeometry(source, {
    kind: 'resize',
    fit: 'contain',
    targetWidth: 612,
    targetHeight: 2000,
    startPage: 1,
    endPage: 1,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles({
    name: 'synthetic-tall.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(tall.bytes),
  });
  await assertFullPage(page);
  const height = await page
    .locator('.pdf-page-canvas')
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeLessThan(900);
  expect(height).toBeGreaterThan(500);
  await page.screenshot({ path: testInfo.outputPath('very-tall-full-page.png') });
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('button', { name: 'Fit full page' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Fit full page' }).click();
  await assertFullPage(page);
});
