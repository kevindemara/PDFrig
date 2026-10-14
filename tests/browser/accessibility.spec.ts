import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const routes = [
  '/',
  '/pricing',
  '/help',
  '/privacy',
  '/retention',
  '/support',
  '/known-limitations',
  '/account',
  '/tools',
  '/workspace',
] as const;

for (const route of routes) {
  test(`WCAG 2.2 automated scan has no detectable violations on ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}
