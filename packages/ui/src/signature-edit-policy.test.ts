import { describe, expect, it } from 'vitest';

import { resolveSignatureEditPolicy } from './signature-edit-policy.js';

const inspection = (
  riskCodes: readonly ('ACTIVE_CONTENT' | 'FORMS' | 'SIGNATURES')[],
  hasSignatures = riskCodes.includes('SIGNATURES'),
  signatureDetection: 'field-only' | 'none' | 'signature-metadata' = hasSignatures
    ? 'field-only'
    : 'none',
) => ({
  canAnnotateSafely: riskCodes.every((risk) => risk === 'FORMS'),
  hasSignatures,
  riskCodes,
  signatureDetection,
});

describe('signed-document edit policy', () => {
  it('requires one acknowledgement before enabling an otherwise supported signed source', () => {
    expect(resolveSignatureEditPolicy([inspection(['SIGNATURES'])], false)).toEqual({
      canAnnotate: false,
      canContinueAfterAcknowledgement: true,
      hasSignatureFields: true,
      requiresAcknowledgement: true,
      signatureDetection: 'field-only',
    });
    expect(resolveSignatureEditPolicy([inspection(['SIGNATURES'])], true)).toEqual({
      canAnnotate: true,
      canContinueAfterAcknowledgement: true,
      hasSignatureFields: true,
      requiresAcknowledgement: false,
      signatureDetection: 'field-only',
    });
  });

  it('allows ordinary forms without an acknowledgement', () => {
    expect(resolveSignatureEditPolicy([inspection(['FORMS'])], false)).toMatchObject({
      canAnnotate: true,
      hasSignatureFields: false,
      requiresAcknowledgement: false,
    });
  });

  it('never lets acknowledgement bypass another structural risk', () => {
    expect(
      resolveSignatureEditPolicy([inspection(['SIGNATURES', 'ACTIVE_CONTENT'])], true),
    ).toEqual({
      canAnnotate: false,
      canContinueAfterAcknowledgement: false,
      hasSignatureFields: true,
      requiresAcknowledgement: false,
      signatureDetection: 'field-only',
    });
  });

  it('keeps only the strongest content-free detection state across sources', () => {
    expect(
      resolveSignatureEditPolicy(
        [inspection(['SIGNATURES']), inspection(['SIGNATURES'], true, 'signature-metadata')],
        false,
      ),
    ).toMatchObject({ signatureDetection: 'signature-metadata' });
  });
});
