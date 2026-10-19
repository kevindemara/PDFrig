import { expect, test } from '@playwright/test';
import path from 'node:path';

test('VIEW-001 VIEW-007 approved PDFrig name appears throughout customer-facing routes and workspace metadata', async ({
  page,
}) => {
  for (const route of [
    '/',
    '/get-started',
    '/help',
    '/known-limitations',
    '/pricing',
    '/privacy',
    '/security',
    '/terms',
    '/retention',
    '/refunds',
    '/subprocessors',
    '/status',
    '/support',
    '/account',
  ]) {
    await page.goto(route);
    await expect(page.locator('body')).not.toContainText('PDFMason');
    await expect(page).toHaveTitle(/PDFrig/u);
  }
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await expect(
    page.getByText('Read-only metadata. PDFrig does not open or extract embedded files.'),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText('PDFMason');
});

test('public beta information architecture is truthful and connected', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page).toHaveTitle('Pricing — PDFrig');
  await expect(
    page.getByRole('heading', { name: 'Pay for the work that costs money.' }),
  ).toBeVisible();
  await expect(page.getByText(/CAD\s*6\.99/u)).toBeVisible();
  await expect(page.getByText(/provisional/i).first()).toBeVisible();

  await page.getByRole('link', { name: 'Help' }).click();
  await expect(page).toHaveTitle('PDFrig Help');
  await expect(page.getByText('VIEW-001').first()).toBeVisible();

  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Your PDF is not analytics.' })).toBeVisible();
  await expect(page.getByText(/does not receive those PDF bytes/i)).toBeVisible();

  await page.goto('/known-limitations');
  await expect(page.getByText('REDACT-001')).toBeVisible();
  await expect(
    page.getByText(/Edit existing text changes supported original string operators/i),
  ).toBeVisible();
});

test('local support and feedback intake accept only structured content-free fields', async ({
  page,
}) => {
  await page.goto('/support');
  await page.getByLabel('Reply email').fill('fixture@example.test');
  await page.getByLabel('Product surface').selectOption('windows');
  await page.getByLabel('Help category').selectOption('windows');
  await page.getByLabel('Safe error code (optional)').fill('NATIVE_FILE_CHANGED');
  await page.getByLabel('Request ID (optional)').fill('request_fixture_01');
  await page.getByLabel(/PDFrig may use this email/i).check();
  // Cold development route compilation is not the UI's post-response render budget.
  const supportResponse = page.waitForResponse('**/api/v1/beta/support');
  await page.getByRole('button', { name: 'Send safe diagnostics' }).click();
  expect((await supportResponse).status()).toBe(202);
  await expect(page.getByRole('status')).toContainText(/BETA-[A-F0-9]{12}/u);

  await page.getByLabel('Capability').selectOption('ORG-003');
  await page.getByLabel('Outcome').selectOption('completed');
  await page.getByLabel('Experience rating').selectOption('5');
  const feedbackResponse = page.waitForResponse('**/api/v1/beta/feedback');
  await page.getByRole('button', { name: 'Send content-free feedback' }).click();
  expect((await feedbackResponse).status()).toBe(202);
  await expect(page.getByRole('status')).toHaveCount(2);

  const invalidStatus = await page.evaluate(async () => {
    const response = await fetch('/api/v1/beta/support', {
      body: JSON.stringify({
        applicationVersion: 'local',
        category: 'local_tool',
        consentToContact: true,
        documentText: 'must never cross this boundary',
        platform: 'web',
        replyEmail: 'fixture@example.test',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    return response.status;
  });
  expect(invalidStatus).toBe(400);
});

test('optional analytics remain off until the user makes a separate choice', async ({ page }) => {
  let analyticsRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/beta/analytics') analyticsRequests += 1;
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Optional, content-free analytics' }),
  ).toBeVisible();
  expect(analyticsRequests).toBe(0);
  await page.getByRole('button', { name: 'Keep analytics off' }).click();
  await page.goto('/pricing');
  expect(analyticsRequests).toBe(0);
  await page.getByRole('button', { name: 'Privacy choices' }).click();
  // Observe without intercepting the POST body; await real server acceptance rather
  // than closing the page as soon as dispatch is observed.
  const acceptedResponse = page.waitForResponse('**/api/v1/beta/analytics');
  await page.getByRole('button', { name: 'Allow optional analytics' }).click();
  await expect.poll(() => analyticsRequests).toBeGreaterThan(0);
  const response = await acceptedResponse;
  expect(response.status()).toBe(202);
  expect(await response.json()).toEqual({ accepted: true });
  expect(await response.finished()).toBeNull();
});

test('content-free status endpoint handles a bounded local burst', async ({ request }) => {
  // Measure the bounded request burst, not Next.js's first-request compilation.
  const warmup = await request.get('/api/v1/status');
  expect(warmup.ok()).toBe(true);
  const started = performance.now();
  const responses = await Promise.all(
    Array.from({ length: 40 }, () => request.get('/api/v1/status')),
  );
  const duration = performance.now() - started;
  expect(responses.every((response) => response.ok())).toBe(true);
  expect(duration).toBeLessThan(5_000);
  const payload = (await responses[0]?.json()) as { report?: unknown };
  expect(payload.report).toBe('local-development');
});

test('compact public pages keep policy and support actions in the viewport', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  for (const route of ['/pricing', '/privacy', '/support', '/known-limitations']) {
    await page.goto(route);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
  }
});
