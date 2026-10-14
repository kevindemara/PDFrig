import type {
  BillingRedirect,
  CreateBillingCheckoutRequest,
  ObjectGrant,
  SafeCloudJob,
  UploadAuthorizationRequest,
  UploadAuthorizationResponse,
  UploadCompletionRequest,
} from '@pdfmason/contracts';

import type { AuthenticatedPrincipal } from '../auth';

export interface AccountSnapshot {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly entitlements: readonly {
    readonly enabled: boolean;
    readonly featureKey: string;
    readonly limitUnit: 'bytes' | 'jobs' | 'pages' | null;
    readonly limitValue: number | null;
    readonly usedValue: number;
  }[];
  readonly historyEnabled: boolean;
  readonly jobs: readonly SafeCloudJob[];
  readonly localDemo: boolean;
  readonly planKey: 'free' | 'pro_annual' | 'pro_monthly';
  readonly processingRegion: string;
  readonly retention: {
    readonly historyDays: number;
    readonly outputHours: number;
    readonly safetyNetHours: number;
  };
  readonly subscriptionStatus:
    'active' | 'cancelled' | 'none' | 'past_due' | 'paused' | 'trialing' | 'unpaid';
  readonly workspaceId: string;
}

export interface CloudService {
  authorizeUpload(
    principal: AuthenticatedPrincipal,
    request: UploadAuthorizationRequest,
  ): Promise<UploadAuthorizationResponse>;
  cancelJob(principal: AuthenticatedPrincipal, jobId: string): Promise<SafeCloudJob | null>;
  completeUpload(
    principal: AuthenticatedPrincipal,
    jobId: string,
    objectId: string,
    request: UploadCompletionRequest,
  ): Promise<SafeCloudJob>;
  createCheckout(
    principal: AuthenticatedPrincipal,
    request: CreateBillingCheckoutRequest,
  ): Promise<BillingRedirect>;
  createDemoJob(principal: AuthenticatedPrincipal, idempotencyKey: string): Promise<SafeCloudJob>;
  createPortal(principal: AuthenticatedPrincipal): Promise<BillingRedirect>;
  createDownloadGrant(principal: AuthenticatedPrincipal, jobId: string): Promise<ObjectGrant>;
  deleteJob(principal: AuthenticatedPrincipal, jobId: string): Promise<SafeCloudJob | null>;
  getAccount(principal: AuthenticatedPrincipal): Promise<AccountSnapshot>;
  getJob(principal: AuthenticatedPrincipal, jobId: string): Promise<SafeCloudJob | null>;
  requestAccountDeletion(principal: AuthenticatedPrincipal, requestId: string): Promise<boolean>;
  setHistoryPreference(
    principal: AuthenticatedPrincipal,
    retainJobHistory: boolean,
  ): Promise<boolean>;
}
