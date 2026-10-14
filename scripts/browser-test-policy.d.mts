export interface BrowserTestPolicy {
  readonly failOnFlakyTests: boolean;
  readonly retries: 0 | 2;
}
export function browserTestPolicy(ci?: string): BrowserTestPolicy;
