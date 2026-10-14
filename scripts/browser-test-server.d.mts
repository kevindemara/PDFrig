export interface BrowserTestServer {
  readonly command: string;
  readonly env: {
    readonly NEXT_PUBLIC_APP_URL: string;
    readonly PDFMASON_ALLOWED_ORIGINS: string;
    readonly PDFMASON_BROWSER_TEST_ISOLATION: '1';
  };
  readonly reuseExistingServer: false;
  readonly url: string;
}
export function browserTestServer(portInput?: string): BrowserTestServer;
