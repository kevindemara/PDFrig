import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import config from './next.config.js';

afterEach(() => vi.unstubAllEnvs());

describe('isolated local QA build surface', () => {
  it('leaves normal preview and production configuration unchanged', () => {
    vi.stubEnv('PDFMASON_BROWSER_TEST_ISOLATION', undefined);
    for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD]) {
      const settings = config(phase);
      expect(settings.distDir).toBeUndefined();
      expect(settings.typescript).toBeUndefined();
      expect(settings.poweredByHeader).toBe(false);
      expect(settings.reactStrictMode).toBe(true);
      expect(settings.agentRules).toBe(false);
    }
  });
  it('isolates the QA cache and inherits strict TypeScript without bypasses', () => {
    vi.stubEnv('PDFMASON_BROWSER_TEST_ISOLATION', '1');
    const settings = config(PHASE_DEVELOPMENT_SERVER);
    expect(settings.distDir).toBe('.next-qa');
    expect(settings.typescript).toEqual({ tsconfigPath: 'tsconfig.qa.json' });
    expect(settings.transpilePackages).toContain('@pdfmason/ui');
    expect(settings.agentRules).toBe(false);
  });
  it('rejects the QA flag in a production build', () => {
    vi.stubEnv('PDFMASON_BROWSER_TEST_ISOLATION', '1');
    expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow('dedicated development server');
  });
  it('rejects arbitrary flag values rather than accepting a path or disabling checks', () => {
    for (const flag of ['', 'true', '0', '../outside', '.next', '1;bad']) {
      vi.stubEnv('PDFMASON_BROWSER_TEST_ISOLATION', flag);
      expect(() => config(PHASE_DEVELOPMENT_SERVER)).toThrow('dedicated development server');
    }
  });
});
