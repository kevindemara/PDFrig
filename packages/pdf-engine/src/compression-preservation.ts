import { PDFArray, PDFDict, PDFName, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';

const catalogFamilies = [
  'Lang',
  'Metadata',
  'MarkInfo',
  'StructTreeRoot',
  'Outlines',
  'OCProperties',
  'OutputIntents',
] as const;

const infoKeys = [
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'ModDate',
] as const;

interface CompressionStructureSnapshot {
  readonly annotations: readonly (readonly string[])[];
  readonly catalog: Readonly<Record<(typeof catalogFamilies)[number], string | null>>;
  readonly fields: readonly string[];
  readonly info: Readonly<Record<(typeof infoKeys)[number], string | null>>;
  readonly optionalContentGroups: readonly string[];
  readonly outputIntents: readonly string[];
}

const resolvedString = (document: PDFDocument, object: PDFObject | undefined): string | null =>
  object === undefined ? null : (document.context.lookup(object)?.toString() ?? null);

const dictionaryValue = (document: PDFDocument, dictionary: PDFDict | undefined, key: string) =>
  resolvedString(document, dictionary?.get(PDFName.of(key)));

const arrayObjects = (
  document: PDFDocument,
  dictionary: PDFDict,
  key: string,
): readonly string[] => {
  const values = dictionary.lookupMaybe(PDFName.of(key), PDFArray);
  if (values === undefined) return [];
  return Array.from({ length: values.size() }, (_, index) =>
    resolvedString(document, values.get(index)),
  ).map((value) => value ?? 'null');
};

const snapshotCompressionStructures = (document: PDFDocument): CompressionStructureSnapshot => {
  const info = document.context.lookupMaybe(document.context.trailerInfo.Info, PDFDict);
  const optionalContent = document.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  const annotations = document.getPages().map((page) => {
    const values = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (values === undefined) return [];
    return Array.from({ length: values.size() }, (_, index) =>
      resolvedString(document, values.get(index)),
    ).map((value) => value ?? 'null');
  });
  const fields = document.catalog.has(PDFName.of('AcroForm'))
    ? document
        .getForm()
        .getFields()
        .map((field) => {
          const type = field.acroField.getInheritableAttribute(PDFName.of('FT'))?.toString() ?? '';
          const value = field.acroField.V()?.toString() ?? '';
          return `${field.getName()}\u0000${type}\u0000${value}\u0000${field.acroField.dict.toString()}`;
        })
        .sort()
    : [];
  return Object.freeze({
    annotations: Object.freeze(annotations.map((page) => Object.freeze(page))),
    catalog: Object.freeze(
      Object.fromEntries(
        catalogFamilies.map((key) => [key, dictionaryValue(document, document.catalog, key)]),
      ) as Record<(typeof catalogFamilies)[number], string | null>,
    ),
    fields: Object.freeze(fields),
    info: Object.freeze(
      Object.fromEntries(
        infoKeys.map((key) => [key, dictionaryValue(document, info, key)]),
      ) as Record<(typeof infoKeys)[number], string | null>,
    ),
    optionalContentGroups: Object.freeze(
      optionalContent === undefined ? [] : arrayObjects(document, optionalContent, 'OCGs'),
    ),
    outputIntents: Object.freeze(arrayObjects(document, document.catalog, 'OutputIntents')),
  });
};

export const assertCompressionStructurePreserved = (
  source: PDFDocument,
  output: PDFDocument,
): void => {
  if (
    JSON.stringify(snapshotCompressionStructures(source)) !==
    JSON.stringify(snapshotCompressionStructures(output))
  ) {
    throw new Error('UTILITY_PRESERVATION_FAILED');
  }
};
