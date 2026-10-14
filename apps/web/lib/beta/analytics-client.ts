import type { BetaAnalyticsEvent } from '@pdfmason/contracts';

/** Optional, content-free telemetry: drain the response without retaining or logging it. */
export const sendBetaAnalytics = async (
  event: BetaAnalyticsEvent,
  fetcher: typeof fetch = fetch,
): Promise<void> => {
  try {
    const response = await fetcher('/api/v1/beta/analytics', {
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    await response.arrayBuffer();
  } catch {
    // Analytics must never block the product or expose transport/body details.
  }
};
