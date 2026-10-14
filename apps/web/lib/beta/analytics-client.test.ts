import { expect, it, vi } from 'vitest';
import { sendBetaAnalytics } from './analytics-client';

const event = {
  event: 'pricing_viewed',
  eventId: '12345678-1234-4234-8234-123456789abc',
  occurredAt: '2026-09-30T12:00:00.000Z',
  surface: 'pricing',
} as const;

it('waits for response consumption and never returns or logs response content', async () => {
  let finish: (() => void) | undefined;
  const response = new Response('synthetic response');
  const consume = vi.spyOn(response, 'arrayBuffer').mockImplementation(
    () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = () => resolve(new ArrayBuffer(0));
      }),
  );
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  let completed = false;
  const sending = sendBetaAnalytics(event, fetcher).then(() => {
    completed = true;
  });
  await vi.waitFor(() => expect(consume).toHaveBeenCalledOnce());
  expect(completed).toBe(false);
  expect(fetcher).toHaveBeenCalledWith('/api/v1/beta/analytics', {
    body: JSON.stringify(event),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (finish === undefined) throw new Error('Missing synthetic response completion');
  finish();
  await expect(sending).resolves.toBeUndefined();
});

it('isolates both transport and response-read failure from the product', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private transport canary'));
  await expect(sendBetaAnalytics(event, fetcher)).resolves.toBeUndefined();
  const response = new Response('synthetic response');
  vi.spyOn(response, 'arrayBuffer').mockRejectedValue(new Error('private response canary'));
  fetcher.mockResolvedValue(response);
  await expect(sendBetaAnalytics(event, fetcher)).resolves.toBeUndefined();
});
