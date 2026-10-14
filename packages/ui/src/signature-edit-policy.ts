import type { PdfInspection, PdfRiskCode } from '@pdfmason/pdf-engine/browser';

type SignatureRelevantInspection = Pick<
  PdfInspection,
  'canAnnotateSafely' | 'hasSignatures' | 'riskCodes' | 'signatureDetection'
>;

export interface SignatureEditPolicy {
  readonly canAnnotate: boolean;
  readonly canContinueAfterAcknowledgement: boolean;
  readonly hasSignatureFields: boolean;
  readonly requiresAcknowledgement: boolean;
  readonly signatureDetection: PdfInspection['signatureDetection'];
}

const acknowledgedEditRisks = new Set<PdfRiskCode>(['FORMS', 'SIGNATURES']);

/**
 * Keeps signature handling conservative: acknowledgement can unlock only the
 * already-supported annotation/form path, never unrelated risky structures.
 */
export const resolveSignatureEditPolicy = (
  inspections: readonly SignatureRelevantInspection[],
  acknowledged: boolean,
): SignatureEditPolicy => {
  const hasSignatureFields = inspections.some(({ hasSignatures }) => hasSignatures);
  const signatureDetection = inspections.some(
    (inspection) => inspection.signatureDetection === 'signature-metadata',
  )
    ? 'signature-metadata'
    : hasSignatureFields
      ? 'field-only'
      : 'none';
  const canContinueAfterAcknowledgement =
    hasSignatureFields &&
    inspections.every(({ riskCodes }) =>
      riskCodes.every((risk) => acknowledgedEditRisks.has(risk)),
    );
  const canAnnotate =
    inspections.every(({ canAnnotateSafely }) => canAnnotateSafely) ||
    (acknowledged && canContinueAfterAcknowledgement);

  return Object.freeze({
    canAnnotate,
    canContinueAfterAcknowledgement,
    hasSignatureFields,
    requiresAcknowledgement: canContinueAfterAcknowledgement && !acknowledged,
    signatureDetection,
  });
};
