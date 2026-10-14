import type {
  BetaAnalyticsEvent,
  BetaFeedbackRequest,
  BetaIntakeReceipt,
  BetaSupportRequest,
} from '@pdfmason/contracts';

export interface BetaService {
  recordAnalytics(event: BetaAnalyticsEvent): Promise<void>;
  submitFeedback(input: BetaFeedbackRequest): Promise<BetaIntakeReceipt>;
  submitSupport(input: BetaSupportRequest): Promise<BetaIntakeReceipt>;
}
