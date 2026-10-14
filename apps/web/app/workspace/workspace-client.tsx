'use client';

import { WorkspaceShell } from '@pdfmason/ui';
import { parsePublicConfig } from '@pdfmason/config/public';
import { createPrintAdapter } from '@pdfmason/editor-core';

const createWorker = (): Worker =>
  new Worker(new URL('./pdf.worker.ts', import.meta.url), {
    name: 'pdfmason-local',
    type: 'module',
  });

const printAdapter = createPrintAdapter(() => globalThis.print());

const commentReviewFlag = process.env.NEXT_PUBLIC_FEATURE_COMMENT_REVIEW_ENABLED;
const stampsFlag = process.env.NEXT_PUBLIC_FEATURE_STAMPS_ENABLED;
const measurementFlag = process.env.NEXT_PUBLIC_FEATURE_MEASUREMENT_ENABLED;
const config = parsePublicConfig({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_FEATURE_REDACTION_ENABLED: process.env.NEXT_PUBLIC_FEATURE_REDACTION_ENABLED,
  ...(commentReviewFlag === undefined
    ? {}
    : { NEXT_PUBLIC_FEATURE_COMMENT_REVIEW_ENABLED: commentReviewFlag }),
  ...(stampsFlag === undefined ? {} : { NEXT_PUBLIC_FEATURE_STAMPS_ENABLED: stampsFlag }),
  ...(measurementFlag === undefined
    ? {}
    : { NEXT_PUBLIC_FEATURE_MEASUREMENT_ENABLED: measurementFlag }),
});

export const WorkspaceClient = () => (
  <WorkspaceShell
    commentReviewEnabled={config.utilityFeatures.commentReview}
    createWorker={createWorker}
    measurementEnabled={config.utilityFeatures.measurement}
    printAdapter={printAdapter}
    redactionEnabled={config.utilityFeatures.redaction}
    stampsEnabled={config.utilityFeatures.stamps}
    surface="Web"
  />
);
