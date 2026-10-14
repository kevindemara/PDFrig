import { PDFDict, PDFName, PDFSignature, type PDFDocument } from '@cantoo/pdf-lib';

export type PdfModificationRisk = 'ACTIVE_CONTENT' | 'ATTACHMENTS' | 'SIGNATURES' | 'XFA';

export type PdfOrganizerRisk = PdfModificationRisk | 'FORMS' | 'OUTLINES' | 'TAGGED_CONTENT';

/** Detects structures that this engine must not silently rewrite. */
export const findPdfModificationRisk = (document: PDFDocument): PdfModificationRisk | null => {
  if (document.catalog.getAcroForm() !== undefined) {
    const form = document.getForm();
    if (form.hasXFA()) return 'XFA';
    if (form.getFields().some((field) => field instanceof PDFSignature)) return 'SIGNATURES';
  }
  if (
    document.catalog.has(PDFName.of('OpenAction')) ||
    document.catalog.has(PDFName.of('AA')) ||
    document.getPages().some((page) => page.node.has(PDFName.of('AA')))
  ) {
    return 'ACTIVE_CONTENT';
  }
  const names = document.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names?.has(PDFName.of('EmbeddedFiles')) === true) return 'ATTACHMENTS';
  if (names?.has(PDFName.of('JavaScript')) === true) return 'ACTIVE_CONTENT';
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFDict &&
      object.lookupMaybe(PDFName.of('S'), PDFName)?.asString() === '/JavaScript'
    ) {
      return 'ACTIVE_CONTENT';
    }
  }
  return null;
};

/** Detects document-level structures that page copying cannot preserve safely. */
export const findPdfOrganizerRisk = (document: PDFDocument): PdfOrganizerRisk | null => {
  const modificationRisk = findPdfModificationRisk(document);
  if (modificationRisk !== null) return modificationRisk;
  if (document.catalog.has(PDFName.of('AcroForm'))) return 'FORMS';
  if (
    document.catalog.has(PDFName.of('StructTreeRoot')) ||
    document.catalog
      .lookupMaybe(PDFName.of('MarkInfo'), PDFDict)
      ?.get(PDFName.of('Marked'))
      ?.toString() === 'true'
  ) {
    return 'TAGGED_CONTENT';
  }
  if (document.catalog.has(PDFName.of('Outlines'))) return 'OUTLINES';
  return null;
};
