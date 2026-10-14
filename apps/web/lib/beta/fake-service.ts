import { randomUUID } from 'node:crypto';

import type {
  BetaAnalyticsEvent,
  BetaFeedbackRequest,
  BetaIntakeReceipt,
  BetaSupportRequest,
} from '@pdfmason/contracts';

import type { BetaService } from './types';

export interface FakeBetaSnapshot {
  readonly analyticsByEvent: Readonly<Record<string, number>>;
  readonly feedbackByOutcome: Readonly<Record<string, number>>;
  readonly supportByCategory: Readonly<Record<string, number>>;
}

const increment = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const receipt = (now: Date): BetaIntakeReceipt => ({
  receivedAt: now.toISOString(),
  reference: `BETA-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
});

/**
 * Local-only proof adapter. It aggregates approved enum values and intentionally
 * discards email, request IDs, and every other support field after validation.
 */
export class FakeBetaService implements BetaService {
  readonly #analyticsByEvent = new Map<string, number>();
  readonly #clock: () => Date;
  readonly #feedbackByOutcome = new Map<string, number>();
  readonly #supportByCategory = new Map<string, number>();

  public constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  public recordAnalytics(event: BetaAnalyticsEvent): Promise<void> {
    increment(this.#analyticsByEvent, event.event);
    return Promise.resolve();
  }

  public submitFeedback(input: BetaFeedbackRequest): Promise<BetaIntakeReceipt> {
    increment(this.#feedbackByOutcome, input.outcome);
    return Promise.resolve(receipt(this.#clock()));
  }

  public submitSupport(input: BetaSupportRequest): Promise<BetaIntakeReceipt> {
    increment(this.#supportByCategory, input.category);
    return Promise.resolve(receipt(this.#clock()));
  }

  public snapshot(): FakeBetaSnapshot {
    return Object.freeze({
      analyticsByEvent: Object.freeze(Object.fromEntries(this.#analyticsByEvent)),
      feedbackByOutcome: Object.freeze(Object.fromEntries(this.#feedbackByOutcome)),
      supportByCategory: Object.freeze(Object.fromEntries(this.#supportByCategory)),
    });
  }
}
