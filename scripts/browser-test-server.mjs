/** Dedicated local QA server: never attach tests to another project's preview. */
export const browserTestServer = (portInput = '3100') => {
  if (!/^[1-9][0-9]{3,4}$/u.test(portInput)) throw new Error('Invalid browser-test port.');
  const port = Number(portInput);
  if (port < 1024 || port > 65535) throw new Error('Invalid browser-test port.');
  const url = `http://127.0.0.1:${port}`;
  return {
    command: `node scripts/check-browser-verifiers.mjs && pnpm build:packages && pnpm --filter @pdfmason/web dev --port ${port}`,
    env: {
      NEXT_PUBLIC_APP_URL: url,
      PDFMASON_ALLOWED_ORIGINS: url,
      PDFMASON_BROWSER_TEST_ISOLATION: '1',
    },
    reuseExistingServer: false,
    url,
  };
};
