export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogPrimitive = boolean | number | string | null;
export type SafeLogValue = LogPrimitive | readonly LogPrimitive[];

export const SAFE_LOG_CONTEXT_FIELDS = Object.freeze([
  'alertId',
  'applicationVersion',
  'attemptCount',
  'byteSizeBucket',
  'durationMs',
  'engineVersion',
  'environment',
  'errorCode',
  'jobId',
  'operation',
  'pageCountBucket',
  'progressStage',
  'requestId',
  'retryable',
  'service',
  'warningCodes',
  'workerVersion',
] as const);

const allowedContextFields = new Set<string>(SAFE_LOG_CONTEXT_FIELDS);

export const isSafeLogContextField = (field: string): boolean => allowedContextFields.has(field);

const isPrimitive = (value: unknown): value is LogPrimitive =>
  value === null || ['boolean', 'number', 'string'].includes(typeof value);

const isSafeValue = (value: unknown): value is SafeLogValue =>
  isPrimitive(value) || (Array.isArray(value) && value.every(isPrimitive));

/** Allowlist-first sanitizer: unknown and sensitive field names disappear completely. */
export const sanitizeLogContext = (input: unknown): Readonly<Record<string, SafeLogValue>> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return Object.freeze({});

  const safeEntries = Object.entries(input).filter(
    (entry): entry is [string, SafeLogValue] =>
      allowedContextFields.has(entry[0]) && isSafeValue(entry[1]),
  );
  return Object.freeze(Object.fromEntries(safeEntries));
};

export interface StructuredLogEntry {
  readonly context: Readonly<Record<string, SafeLogValue>>;
  readonly event: string;
  readonly level: LogLevel;
  readonly timestamp: string;
}

export type LogSink = (serializedEntry: string) => void;

export const createSafeLogger = (
  sink: LogSink,
  clock: () => Date = () => new Date(),
): {
  log(level: LogLevel, event: string, context?: unknown): void;
} => ({
  log(level, event, context = {}): void {
    const entry: StructuredLogEntry = {
      context: sanitizeLogContext(context),
      event,
      level,
      timestamp: clock().toISOString(),
    };
    sink(JSON.stringify(entry));
  },
});

export type AlertSeverity = 'critical' | 'high' | 'warning';

export interface ActionableAlert {
  readonly id: string;
  readonly owner: 'application' | 'database' | 'release' | 'security' | 'worker';
  readonly runbook: string;
  readonly safeDimensions: readonly (typeof SAFE_LOG_CONTEXT_FIELDS)[number][];
  readonly severity: AlertSeverity;
  readonly signal: string;
  readonly threshold: string;
  readonly window: string;
}

const alert = (definition: ActionableAlert): ActionableAlert => Object.freeze(definition);

/**
 * Content-free operational catalogue. Provider-specific monitor IDs belong in deployment config,
 * never here; every signal must page toward an executable repository runbook.
 */
export const ACTIONABLE_ALERTS = Object.freeze([
  alert({
    id: 'api.error-budget-burn',
    owner: 'application',
    runbook: 'docs/operations/handbook.txt#api-and-provider-degradation',
    safeDimensions: ['alertId', 'environment', 'errorCode', 'service'],
    severity: 'high',
    signal: 'Safe 5xx count divided by request count',
    threshold: 'Greater than 5% and at least 20 failures',
    window: '5 minutes',
  }),
  alert({
    id: 'database.authorization-denial-spike',
    owner: 'security',
    runbook: 'docs/operations/handbook.txt#security-and-tenant-isolation',
    safeDimensions: ['alertId', 'environment', 'errorCode', 'service'],
    severity: 'critical',
    signal: 'Content-free authorization denial count',
    threshold: 'Five times the trailing seven-day window baseline',
    window: '10 minutes',
  }),
  alert({
    id: 'deletion.reconciliation-stalled',
    owner: 'database',
    runbook: 'docs/operations/handbook.txt#deletion-reconciliation',
    safeDimensions: ['alertId', 'attemptCount', 'environment', 'errorCode', 'service'],
    severity: 'critical',
    signal: 'Deletion records in attention state',
    threshold: 'One or more records, or oldest pending age over 30 minutes',
    window: '5 minutes',
  }),
  alert({
    id: 'jobs.queue-age-high',
    owner: 'worker',
    runbook: 'docs/operations/handbook.txt#job-backlog',
    safeDimensions: ['alertId', 'environment', 'operation', 'service'],
    severity: 'warning',
    signal: 'Oldest runnable job age',
    threshold: 'Above the operation service objective for three samples',
    window: '15 minutes',
  }),
  alert({
    id: 'storage.orphan-detected',
    owner: 'database',
    runbook: 'docs/operations/handbook.txt#deletion-reconciliation',
    safeDimensions: ['alertId', 'environment', 'service'],
    severity: 'high',
    signal: 'Opaque object inventory without live metadata',
    threshold: 'One or more objects older than the safety-net retention',
    window: 'Daily reconciliation',
  }),
  alert({
    id: 'webhook.processing-lag',
    owner: 'application',
    runbook: 'docs/operations/handbook.txt#api-and-provider-degradation',
    safeDimensions: ['alertId', 'environment', 'errorCode', 'service'],
    severity: 'high',
    signal: 'Oldest verified unprocessed webhook age',
    threshold: 'Over 10 minutes',
    window: '5 minutes',
  }),
  alert({
    id: 'release.update-failure-rate',
    owner: 'release',
    runbook: 'docs/operations/handbook.txt#release-rollback',
    safeDimensions: ['alertId', 'applicationVersion', 'environment', 'errorCode', 'service'],
    severity: 'high',
    signal: 'Content-free signed update failure count',
    threshold: 'Over 2% and at least 10 eligible installations',
    window: '30 minutes',
  }),
]);
