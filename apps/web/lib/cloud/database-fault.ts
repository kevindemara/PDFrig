import { ApiFault } from '../api';

/** Only exact content-free database codes cross the trusted API boundary. */
export const throwCloudDatabaseFault = (message: string): never => {
  switch (message) {
    case 'IDEMPOTENCY_CONFLICT':
      throw new ApiFault(
        'STATE_CONFLICT',
        'This request key belongs to a different action. Start a new request.',
        409,
      );
    case 'INVALID_JOB_RESERVATION':
    case 'SENSITIVE_JOB_OPTION_FORBIDDEN':
    case 'USAGE_UNIT_MISMATCH':
      throw new ApiFault(
        'INPUT_INVALID',
        'The cloud request is not supported. Check its settings.',
        400,
      );
    case 'QUOTA_EXCEEDED':
      throw new ApiFault('QUOTA_EXCEEDED', 'This workspace has reached its cloud allowance.', 409);
    case 'ENTITLEMENT_REQUIRED':
      throw new ApiFault(
        'ENTITLEMENT_REQUIRED',
        'This workspace is not entitled to that cloud action.',
        403,
      );
    case 'WORKSPACE_ACCESS_DENIED':
      throw new ApiFault('NOT_FOUND', 'The requested resource was not found.', 404);
    default:
      throw new ApiFault(
        'PROVIDER_UNAVAILABLE',
        'The operation stopped safely. Try again later.',
        503,
        true,
      );
  }
};
