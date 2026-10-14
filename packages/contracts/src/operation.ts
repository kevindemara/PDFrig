import { z } from 'zod';

import { isFeatureId, type FeatureId } from './feature-registry.js';

export const executionLocations = ['local', 'cloud', 'either'] as const;
export type ExecutionLocation = (typeof executionLocations)[number];

export const fidelityEffects = [
  'none',
  'may_flatten',
  'may_rasterize',
  'may_discard_forms',
  'may_remove_tags',
  'may_change_colour_profile',
  'may_invalidate_signatures',
] as const;
export type FidelityEffect = (typeof fidelityEffects)[number];

export const failureCategories = [
  'cancelled',
  'capability_unavailable',
  'input_invalid',
  'input_unsupported',
  'limit_exceeded',
  'permission_denied',
  'processing_failed',
  'verification_failed',
] as const;
export type FailureCategory = (typeof failureCategories)[number];

export interface InputConstraints {
  readonly acceptedMimeTypes: readonly string[];
  readonly maximumBytes: number | null;
  readonly maximumFiles: number;
  readonly maximumPages: number | null;
  readonly passwordHandling: 'never' | 'memory-only';
}

export interface OperationOptionDefinition {
  readonly deterministic: true;
  readonly key: string;
  readonly required: boolean;
  readonly type: 'boolean' | 'integer' | 'number' | 'string' | 'string-array';
}

export interface ProgressStage {
  readonly cancellable: boolean;
  readonly key: string;
  readonly label: string;
}

export interface OutputContract {
  readonly filenameSuggestion: string;
  readonly mimeType: string;
}

export interface ProvenanceContract {
  readonly contentFreeFields: readonly (
    'engineName' | 'engineVersion' | 'operationVersion' | 'outputSha256' | 'sourceSha256'
  )[];
}

export interface PdfOperationContract {
  readonly cancellation: 'not-supported' | 'stage-boundary' | 'cooperative';
  readonly executionLocation: ExecutionLocation;
  readonly failureCategories: readonly FailureCategory[];
  readonly featureIds: readonly FeatureId[];
  readonly fidelityEffects: readonly FidelityEffect[];
  readonly input: InputConstraints;
  readonly operation: string;
  readonly options: readonly OperationOptionDefinition[];
  readonly output: OutputContract;
  readonly progressStages: readonly ProgressStage[];
  readonly provenance: ProvenanceContract;
  /** Option values that must never cross a persistence, telemetry, or log boundary. */
  readonly secretOptionKeys?: readonly string[];
  readonly version: string;
  readonly warningCodes: readonly string[];
}

const featureIdSchema = z.string().refine(isFeatureId, 'Unknown PDFMason feature ID');

export const pdfOperationContractSchema = z
  .object({
    cancellation: z.enum(['not-supported', 'stage-boundary', 'cooperative']),
    executionLocation: z.enum(executionLocations),
    failureCategories: z.array(z.enum(failureCategories)).min(1),
    featureIds: z.array(featureIdSchema).min(1),
    fidelityEffects: z.array(z.enum(fidelityEffects)),
    input: z.object({
      acceptedMimeTypes: z.array(z.string().min(1)),
      maximumBytes: z.number().int().positive().nullable(),
      maximumFiles: z.number().int().nonnegative(),
      maximumPages: z.number().int().positive().nullable(),
      passwordHandling: z.enum(['never', 'memory-only']),
    }),
    operation: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/),
    options: z.array(
      z.object({
        deterministic: z.literal(true),
        key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
        required: z.boolean(),
        type: z.enum(['boolean', 'integer', 'number', 'string', 'string-array']),
      }),
    ),
    output: z.object({
      filenameSuggestion: z.string().min(1),
      mimeType: z.string().min(1),
    }),
    progressStages: z.array(
      z.object({
        cancellable: z.boolean(),
        key: z.string().regex(/^[a-z][a-z0-9_]*$/),
        label: z.string().min(1),
      }),
    ),
    provenance: z.object({
      contentFreeFields: z.array(
        z.enum(['engineName', 'engineVersion', 'operationVersion', 'outputSha256', 'sourceSha256']),
      ),
    }),
    secretOptionKeys: z.array(z.string().regex(/^[a-z][a-zA-Z0-9]*$/)).optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    warningCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
  })
  .superRefine(({ input }, context) => {
    if ((input.maximumFiles === 0) !== (input.acceptedMimeTypes.length === 0)) {
      context.addIssue({
        code: 'custom',
        message: 'Source-free operations must declare zero files and no accepted MIME types.',
        path: ['input'],
      });
    }
  });

const localInput = Object.freeze({
  acceptedMimeTypes: Object.freeze(['application/pdf']),
  maximumBytes: 50 * 1024 * 1024,
  maximumFiles: 20,
  maximumPages: 500,
  passwordHandling: 'memory-only' as const,
});

const provenance = Object.freeze({
  contentFreeFields: Object.freeze([
    'engineName',
    'engineVersion',
    'operationVersion',
    'outputSha256',
    'sourceSha256',
  ] as const),
});

const commonFailures = Object.freeze([
  'cancelled',
  'input_invalid',
  'input_unsupported',
  'limit_exceeded',
  'processing_failed',
  'verification_failed',
] as const);

/** Reviewed operation contracts. Implementations remain behind the PDF engine adapter. */
export const PDF_OPERATION_REGISTRY = Object.freeze({
  'annotations.apply': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze([
      'EDIT-001',
      'ANNO-001',
      'ANNO-002',
      'ANNO-003',
      'ANNO-004',
      'ANNO-005',
      'ANNO-006',
      'ANNO-007',
    ] as const),
    fidelityEffects: Object.freeze(['may_flatten'] as const),
    input: Object.freeze({ ...localInput, maximumFiles: 1 }),
    operation: 'annotations.apply',
    options: Object.freeze([
      Object.freeze({
        deterministic: true,
        key: 'annotationGraph',
        required: true,
        type: 'string',
      }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-annotated.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting source' }),
      Object.freeze({ cancellable: false, key: 'apply', label: 'Applying annotations' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    version: '1.3.0',
    warningCodes: Object.freeze([
      'ANNOTATIONS_FLATTENED',
      'TEXT_ENCODING_LIMITED',
      'ADDED_CONTENT_UNTAGGED',
    ]),
  }),
  'forms.fill': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['FORM-001', 'FORM-002'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({ ...localInput, maximumFiles: 1 }),
    operation: 'forms.fill',
    options: Object.freeze([
      Object.freeze({
        deterministic: true,
        key: 'fieldValues',
        required: true,
        type: 'string',
      }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-filled.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting fields' }),
      Object.freeze({ cancellable: false, key: 'fill', label: 'Filling fields' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying appearances' }),
    ]),
    provenance,
    version: '1.0.1',
    warningCodes: Object.freeze(['UNSUPPORTED_FORM_FIELD_BLOCKED']),
  }),
  'forms.data.exchange': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['FORM-003'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({
      acceptedMimeTypes: Object.freeze(['application/json']),
      maximumBytes: 1_048_576,
      maximumFiles: 1,
      maximumPages: null,
      passwordHandling: 'never' as const,
    }),
    operation: 'forms.data.exchange',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'mode', required: true, type: 'string' }),
      Object.freeze({ deterministic: true, key: 'fieldValues', required: true, type: 'string' }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'pdfmason-form-data.json',
      mimeType: 'application/json',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'validate', label: 'Validating form data' }),
      Object.freeze({ cancellable: true, key: 'review', label: 'Reviewing field values' }),
      Object.freeze({ cancellable: false, key: 'apply', label: 'Applying or saving form data' }),
    ]),
    provenance: Object.freeze({ contentFreeFields: Object.freeze(['operationVersion'] as const) }),
    secretOptionKeys: Object.freeze(['fieldValues']),
    version: '1.0.0',
    warningCodes: Object.freeze([
      'FORM_DATA_SENSITIVE',
      'EDITABLE_FIELDS_ONLY',
      'FORM_TEMPLATE_REQUIRES_REVIEW',
    ]),
  }),
  'document.crop': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['ORG-009'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({ ...localInput, maximumFiles: 1, passwordHandling: 'never' as const }),
    operation: 'document.crop',
    options: Object.freeze([
      Object.freeze({
        deterministic: true,
        key: 'cropPlan',
        required: true,
        type: 'string',
      }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-cropped.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting page boxes' }),
      Object.freeze({ cancellable: false, key: 'apply', label: 'Applying crop boxes' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    version: '1.0.0',
    warningCodes: Object.freeze([
      'ACTIVE_CONTENT_BLOCKED',
      'ATTACHMENTS_BLOCKED',
      'CROP_IS_NOT_REDACTION',
      'HIDDEN_CONTENT_REMAINS_RECOVERABLE',
      'SIGNATURES_BLOCKED',
      'XFA_BLOCKED',
    ]),
  }),
  'document.resize': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['ORG-010'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({ ...localInput, maximumFiles: 1, passwordHandling: 'never' as const }),
    operation: 'document.resize',
    options: Object.freeze([
      Object.freeze({
        deterministic: true,
        key: 'resizePlan',
        required: true,
        type: 'string',
      }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-resized.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting page geometry' }),
      Object.freeze({ cancellable: false, key: 'apply', label: 'Normalizing page sizes' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    version: '1.0.0',
    warningCodes: Object.freeze([
      'ACTIVE_CONTENT_BLOCKED',
      'ANNOTATIONS_BLOCKED',
      'ATTACHMENTS_BLOCKED',
      'COVER_MAY_HIDE_CONTENT',
      'FORMS_BLOCKED',
      'PREPRESS_BOXES_BLOCKED',
      'SIGNATURES_BLOCKED',
      'TAGGED_PDF_BLOCKED',
      'XFA_BLOCKED',
    ]),
  }),
  'document.decorate': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['EDIT-006', 'EDIT-007'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({ ...localInput, maximumFiles: 1, passwordHandling: 'never' as const }),
    operation: 'document.decorate',
    options: Object.freeze([
      Object.freeze({
        deterministic: true,
        key: 'decorationPlan',
        required: true,
        type: 'string',
      }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-decorated.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting source' }),
      Object.freeze({ cancellable: false, key: 'apply', label: 'Adding page decorations' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    version: '1.1.1',
    warningCodes: Object.freeze([
      'ACTIVE_CONTENT_BLOCKED',
      'ATTACHMENTS_BLOCKED',
      'DECORATIONS_MARKED_AS_ARTIFACTS',
      'PLACEMENT_REQUIRES_VISUAL_REVIEW',
      'SIGNATURES_BLOCKED',
      'STANDARD_FONT_ENCODING_LIMITED',
      'XFA_BLOCKED',
    ]),
  }),
  'document.number': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['ORG-011', 'ORG-012'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({ ...localInput, maximumFiles: 1, passwordHandling: 'never' as const }),
    operation: 'document.number',
    options: Object.freeze([
      Object.freeze({
        deterministic: true,
        key: 'numberingPlan',
        required: true,
        type: 'string',
      }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-numbered.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting source' }),
      Object.freeze({ cancellable: false, key: 'apply', label: 'Applying numbering' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
      Object.freeze({ cancellable: false, key: 'report', label: 'Preparing local report' }),
    ]),
    provenance,
    version: '1.0.3',
    warningCodes: Object.freeze([
      'ACTIVE_CONTENT_BLOCKED',
      'ATTACHMENTS_BLOCKED',
      'EXISTING_PAGE_LABELS_REQUIRE_REPLACEMENT_CONFIRMATION',
      'NUMBERING_MARKED_AS_ARTIFACTS',
      'IDENTIFIER_LIMIT',
      'PAGE_BOX_UNSUPPORTED',
      'ROTATION_UNSUPPORTED',
      'SIGNATURES_BLOCKED',
      'STANDARD_FONT_ENCODING_LIMITED',
      'TEXT_CONTROL_UNSUPPORTED',
      'TEXT_DOES_NOT_FIT',
      'XFA_BLOCKED',
    ]),
  }),
  'forms.flatten': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['FORM-007'] as const),
    fidelityEffects: Object.freeze(['may_flatten', 'may_discard_forms'] as const),
    input: Object.freeze({ ...localInput, maximumFiles: 1 }),
    operation: 'forms.flatten',
    options: Object.freeze([
      Object.freeze({
        deterministic: true,
        key: 'confirmFormSemanticsRemoval',
        required: true,
        type: 'boolean',
      }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-flattened.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting fields' }),
      Object.freeze({ cancellable: false, key: 'flatten', label: 'Flattening fields' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    version: '1.0.0',
    warningCodes: Object.freeze(['FORM_EDITABILITY_REMOVED', 'FORM_SEMANTICS_REMOVED']),
  }),
  'pages.assemble': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze([
      'ORG-001',
      'ORG-003',
      'ORG-004',
      'ORG-005',
      'ORG-007',
      'ORG-008',
    ] as const),
    fidelityEffects: Object.freeze([
      'may_discard_forms',
      'may_remove_tags',
      'may_invalidate_signatures',
    ] as const),
    input: localInput,
    operation: 'pages.assemble',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'pageGraph', required: true, type: 'string' }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-organized.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting sources' }),
      Object.freeze({ cancellable: false, key: 'assemble', label: 'Assembling pages' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    version: '1.0.1',
    warningCodes: Object.freeze([
      'ACTIVE_CONTENT_BLOCKED',
      'ATTACHMENTS_BLOCKED',
      'ENCRYPTED_BLOCKED',
      'FORMS_BLOCKED',
      'INCREMENTAL_REVISIONS_BLOCKED',
      'MALFORMED_STRUCTURE_BLOCKED',
      'OUTLINES_BLOCKED',
      'SIGNATURES_BLOCKED',
      'TAGGED_CONTENT_BLOCKED',
      'XFA_BLOCKED',
    ]),
  }),
  'pages.extract': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['ORG-002', 'ORG-006'] as const),
    fidelityEffects: Object.freeze([
      'may_discard_forms',
      'may_remove_tags',
      'may_invalidate_signatures',
    ] as const),
    input: localInput,
    operation: 'pages.extract',
    options: Object.freeze([
      Object.freeze({
        deterministic: true,
        key: 'pageRanges',
        required: true,
        type: 'string-array',
      }),
    ]),
    output: Object.freeze({ filenameSuggestion: 'document-part.pdf', mimeType: 'application/pdf' }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting source' }),
      Object.freeze({ cancellable: false, key: 'extract', label: 'Extracting pages' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    version: '1.0.1',
    warningCodes: Object.freeze([
      'ACTIVE_CONTENT_BLOCKED',
      'ATTACHMENTS_BLOCKED',
      'ENCRYPTED_BLOCKED',
      'FORMS_BLOCKED',
      'INCREMENTAL_REVISIONS_BLOCKED',
      'MALFORMED_STRUCTURE_BLOCKED',
      'OUTLINES_BLOCKED',
      'SIGNATURES_BLOCKED',
      'TAGGED_CONTENT_BLOCKED',
      'XFA_BLOCKED',
    ]),
  }),
  'signatures.visual': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['SIGN-001', 'SIGN-002', 'SIGN-003'] as const),
    fidelityEffects: Object.freeze(['may_flatten'] as const),
    input: Object.freeze({ ...localInput, maximumFiles: 1 }),
    operation: 'signatures.visual',
    options: Object.freeze([
      Object.freeze({
        deterministic: true,
        key: 'visualAppearance',
        required: true,
        type: 'string',
      }),
      Object.freeze({
        deterministic: true,
        key: 'destinationPageIds',
        required: false,
        type: 'string-array',
      }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-visual-signature.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting source' }),
      Object.freeze({ cancellable: true, key: 'review', label: 'Reviewing each placement' }),
      Object.freeze({ cancellable: false, key: 'apply', label: 'Applying visual mark' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    secretOptionKeys: Object.freeze(['visualAppearance', 'destinationPageIds']),
    version: '1.1.0',
    warningCodes: Object.freeze([
      'VISUAL_MARK_FLATTENED',
      'VISUAL_SIGNATURE_NOT_DIGITAL',
      'PLACEMENT_REQUIRES_VISUAL_REVIEW',
    ]),
  }),
  'view.open': Object.freeze({
    cancellation: 'cooperative',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['VIEW-001', 'VIEW-002', 'VIEW-004', 'VIEW-005', 'SEC-006'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({ ...localInput, maximumFiles: 1 }),
    operation: 'view.open',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'password', required: false, type: 'string' }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'in-memory-document',
      mimeType: 'application/x.pdfmason-document',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting document' }),
      Object.freeze({ cancellable: true, key: 'render', label: 'Rendering page' }),
    ]),
    provenance,
    secretOptionKeys: Object.freeze(['password']),
    version: '1.0.0',
    warningCodes: Object.freeze([
      'ACTIVE_CONTENT_DISABLED',
      'ORGANIZER_LOCKED',
      'PASSWORD_REQUIRED',
    ]),
  }),
  'optimize.compress': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['OPT-001', 'SEC-006', 'SEC-007'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({ ...localInput, maximumFiles: 1 }),
    operation: 'optimize.compress',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'preset', required: true, type: 'string' }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-optimized.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting structure' }),
      Object.freeze({ cancellable: false, key: 'rewrite', label: 'Optimizing structure' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    version: '1.0.5',
    warningCodes: Object.freeze(['ALREADY_OPTIMIZED', 'LOSSLESS_ONLY']),
  }),
  'security.protect': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['SEC-001'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({ ...localInput, maximumFiles: 1 }),
    operation: 'security.protect',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'password', required: true, type: 'string' }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-protected.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting source' }),
      Object.freeze({ cancellable: false, key: 'encrypt', label: 'Applying AES-256 protection' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying protection' }),
    ]),
    provenance,
    secretOptionKeys: Object.freeze(['password']),
    version: '1.0.1',
    warningCodes: Object.freeze([
      'PASSWORD_NOT_RECOVERABLE',
      'PDF_VERSION_MAY_INCREASE',
      'UNSUPPORTED_STRING_LAYOUT_BLOCKED',
      'SIGNATURES_BLOCKED',
    ]),
  }),
  'security.permissions': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['SEC-003'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({ ...localInput, maximumFiles: 1 }),
    operation: 'security.permissions',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'printing', required: true, type: 'string' }),
      Object.freeze({ deterministic: true, key: 'copying', required: true, type: 'boolean' }),
      Object.freeze({ deterministic: true, key: 'modifying', required: true, type: 'boolean' }),
      Object.freeze({ deterministic: true, key: 'annotating', required: true, type: 'boolean' }),
      Object.freeze({ deterministic: true, key: 'fillingForms', required: true, type: 'boolean' }),
      Object.freeze({
        deterministic: true,
        key: 'documentAssembly',
        required: true,
        type: 'boolean',
      }),
      Object.freeze({ deterministic: true, key: 'ownerPassword', required: true, type: 'string' }),
      Object.freeze({ deterministic: true, key: 'openPassword', required: true, type: 'string' }),
      Object.freeze({ deterministic: true, key: 'authorized', required: true, type: 'boolean' }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'pdfmason-permissions.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({
        cancellable: true,
        key: 'inspect',
        label: 'Inspecting source and authorization',
      }),
      Object.freeze({
        cancellable: false,
        key: 'encrypt',
        label: 'Applying AES-256 permission flags',
      }),
      Object.freeze({
        cancellable: false,
        key: 'verify',
        label: 'Verifying flags and source objects',
      }),
    ]),
    provenance,
    secretOptionKeys: Object.freeze(['ownerPassword', 'openPassword']),
    version: '1.0.0',
    warningCodes: Object.freeze([
      'PERMISSIONS_NOT_DRM',
      'EMPTY_OPEN_PASSWORD_NO_CONFIDENTIALITY',
      'PASSWORD_NOT_RECOVERABLE',
      'PDF_VERSION_MAY_INCREASE',
    ]),
  }),
  'security.decrypt': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['SEC-002'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({ ...localInput, maximumFiles: 1 }),
    operation: 'security.decrypt',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'password', required: true, type: 'string' }),
      Object.freeze({ deterministic: true, key: 'authorized', required: true, type: 'boolean' }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-unlocked.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'authorize', label: 'Confirming authorization' }),
      Object.freeze({ cancellable: false, key: 'decrypt', label: 'Removing open protection' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    secretOptionKeys: Object.freeze(['password']),
    version: '1.0.1',
    warningCodes: Object.freeze(['SIGNATURES_BLOCKED', 'UNSUPPORTED_STRING_LAYOUT_BLOCKED']),
  }),
  'metadata.edit': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['SEC-004'] as const),
    fidelityEffects: Object.freeze(['may_invalidate_signatures'] as const),
    input: Object.freeze({ ...localInput, maximumFiles: 1, passwordHandling: 'never' as const }),
    operation: 'metadata.edit',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'metadataPatch', required: false, type: 'string' }),
      Object.freeze({ deterministic: true, key: 'removeAll', required: true, type: 'boolean' }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-metadata-updated.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Reading metadata' }),
      Object.freeze({ cancellable: false, key: 'update', label: 'Updating metadata' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying metadata' }),
    ]),
    provenance,
    version: '1.0.0',
    warningCodes: Object.freeze(['SIGNATURES_INVALIDATED', 'XMP_REMOVED']),
  }),
  'convert.pdf.image': Object.freeze({
    cancellation: 'cooperative',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['CONV-001'] as const),
    fidelityEffects: Object.freeze(['may_rasterize', 'may_change_colour_profile'] as const),
    input: Object.freeze({ ...localInput, maximumFiles: 1 }),
    operation: 'convert.pdf.image',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'format', required: true, type: 'string' }),
      Object.freeze({ deterministic: true, key: 'scale', required: true, type: 'number' }),
      Object.freeze({
        deterministic: true,
        key: 'pageRange',
        required: true,
        type: 'string',
      }),
      Object.freeze({
        deterministic: true,
        key: 'jpegQuality',
        required: true,
        type: 'number',
      }),
      Object.freeze({
        deterministic: true,
        key: 'transparentBackground',
        required: true,
        type: 'boolean',
      }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-pages.zip',
      mimeType: 'application/zip',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting pages' }),
      Object.freeze({ cancellable: true, key: 'render', label: 'Rendering pages' }),
      Object.freeze({ cancellable: false, key: 'package', label: 'Packaging images' }),
    ]),
    provenance,
    version: '1.1.0',
    warningCodes: Object.freeze([
      'COLOUR_PROFILE_NOT_PRESERVED',
      'OUTPUT_RASTERIZED',
      'TRANSPARENCY_DEPENDS_ON_PAGE_CONTENT',
    ]),
  }),
  'convert.text.pdf': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['CONV-005'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({
      acceptedMimeTypes: Object.freeze(['text/plain']),
      maximumBytes: 1_048_576,
      maximumFiles: 1,
      maximumPages: 500,
      passwordHandling: 'never' as const,
    }),
    operation: 'convert.text.pdf',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'pageSize', required: true, type: 'string' }),
    ]),
    output: Object.freeze({ filenameSuggestion: 'pdfmason-text.pdf', mimeType: 'application/pdf' }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'validate', label: 'Validating UTF-8 text' }),
      Object.freeze({ cancellable: false, key: 'build', label: 'Building text pages' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output pages' }),
    ]),
    provenance,
    version: '1.0.0',
    warningCodes: Object.freeze([
      'TEXT_LAYOUT_NORMALIZED',
      'OUTPUT_UNTAGGED',
      'STANDARD_COURIER_FONT',
    ]),
  }),
  'create.blank.pdf': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['CREATE-001'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({
      acceptedMimeTypes: Object.freeze([] as const),
      maximumBytes: null,
      maximumFiles: 0,
      maximumPages: null,
      passwordHandling: 'never' as const,
    }),
    operation: 'create.blank.pdf',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'pageCount', required: false, type: 'number' }),
      Object.freeze({ deterministic: true, key: 'pageSize', required: true, type: 'string' }),
      Object.freeze({ deterministic: true, key: 'orientation', required: true, type: 'string' }),
      Object.freeze({ deterministic: true, key: 'marginPoints', required: true, type: 'number' }),
    ]),
    output: Object.freeze({ filenameSuggestion: 'blank.pdf', mimeType: 'application/pdf' }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'validate', label: 'Validating page settings' }),
      Object.freeze({ cancellable: false, key: 'create', label: 'Creating blank pages' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying page boxes' }),
    ]),
    provenance: Object.freeze({
      contentFreeFields: Object.freeze([
        'engineName',
        'engineVersion',
        'operationVersion',
        'outputSha256',
      ] as const),
    }),
    version: '1.1.0',
    warningCodes: Object.freeze(['ART_BOX_MAY_NOT_DISPLAY']),
  }),
  'create.images.pdf': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['CREATE-002'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({
      ...localInput,
      acceptedMimeTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
      maximumFiles: 100,
      maximumPages: 100,
      passwordHandling: 'never' as const,
    }),
    operation: 'create.images.pdf',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'pageSize', required: true, type: 'string' }),
      Object.freeze({ deterministic: true, key: 'fit', required: true, type: 'string' }),
    ]),
    output: Object.freeze({ filenameSuggestion: 'images.pdf', mimeType: 'application/pdf' }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting images' }),
      Object.freeze({ cancellable: false, key: 'compose', label: 'Building pages' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    version: '1.1.0',
    warningCodes: Object.freeze(['IMAGE_CROPPED', 'IMAGE_METADATA_REMOVED']),
  }),
  'create.image.page': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['ORG-008'] as const),
    fidelityEffects: Object.freeze([]),
    input: Object.freeze({
      ...localInput,
      acceptedMimeTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
      maximumFiles: 1,
      maximumPages: 1,
      passwordHandling: 'never' as const,
    }),
    operation: 'create.image.page',
    options: Object.freeze([]),
    output: Object.freeze({ filenameSuggestion: 'image-page.pdf', mimeType: 'application/pdf' }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting image' }),
      Object.freeze({ cancellable: false, key: 'normalize', label: 'Applying orientation' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying page' }),
    ]),
    provenance,
    version: '1.0.0',
    warningCodes: Object.freeze(['IMAGE_METADATA_REMOVED']),
  }),
  'convert.office.pdf': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'cloud',
    failureCategories: Object.freeze([...commonFailures, 'capability_unavailable'] as const),
    featureIds: Object.freeze(['CONV-002', 'CONV-003', 'CONV-004'] as const),
    fidelityEffects: Object.freeze(['may_remove_tags', 'may_change_colour_profile'] as const),
    input: Object.freeze({
      acceptedMimeTypes: Object.freeze([
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ]),
      maximumBytes: 50_000_000,
      maximumFiles: 1,
      maximumPages: null,
      passwordHandling: 'never' as const,
    }),
    operation: 'convert.office.pdf',
    options: Object.freeze([]),
    output: Object.freeze({ filenameSuggestion: 'converted.pdf', mimeType: 'application/pdf' }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting Office document' }),
      Object.freeze({
        cancellable: false,
        key: 'convert',
        label: 'Converting in an isolated worker',
      }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying output' }),
    ]),
    provenance,
    version: '0.1.0',
    warningCodes: Object.freeze([
      'BETA_FIDELITY_REVIEW',
      'FONT_SUBSTITUTION_POSSIBLE',
      'MACROS_BLOCKED',
    ]),
  }),
  'ocr.searchable.pdf': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'cloud',
    failureCategories: Object.freeze([...commonFailures, 'capability_unavailable'] as const),
    featureIds: Object.freeze(['OCR-001'] as const),
    fidelityEffects: Object.freeze(['may_invalidate_signatures'] as const),
    input: Object.freeze({
      acceptedMimeTypes: Object.freeze(['application/pdf']),
      maximumBytes: 50_000_000,
      maximumFiles: 1,
      maximumPages: 50,
      passwordHandling: 'never' as const,
    }),
    operation: 'ocr.searchable.pdf',
    options: Object.freeze([
      Object.freeze({
        deterministic: true,
        key: 'languages',
        required: true,
        type: 'string-array',
      }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-searchable.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting scanned pages' }),
      Object.freeze({ cancellable: false, key: 'recognize', label: 'Recognizing text securely' }),
      Object.freeze({ cancellable: false, key: 'compose', label: 'Adding the searchable layer' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying searchable output' }),
    ]),
    provenance,
    version: '0.1.0',
    warningCodes: Object.freeze([
      'BETA_REVIEW_REQUIRED',
      'EXISTING_TEXT_LAYER_POSSIBLE',
      'HANDWRITING_NOT_GUARANTEED',
      'SIGNATURES_INVALIDATED',
    ]),
  }),
  'redaction.raster.apply': Object.freeze({
    cancellation: 'stage-boundary',
    executionLocation: 'local',
    failureCategories: commonFailures,
    featureIds: Object.freeze(['REDACT-001'] as const),
    fidelityEffects: Object.freeze([
      'may_flatten',
      'may_rasterize',
      'may_discard_forms',
      'may_remove_tags',
      'may_invalidate_signatures',
    ] as const),
    input: Object.freeze({
      ...localInput,
      maximumFiles: 1,
      maximumPages: 25,
      passwordHandling: 'never' as const,
    }),
    operation: 'redaction.raster.apply',
    options: Object.freeze([
      Object.freeze({ deterministic: true, key: 'redactionGraph', required: true, type: 'string' }),
      Object.freeze({
        deterministic: true,
        key: 'confirmPermanentRemoval',
        required: true,
        type: 'boolean',
      }),
      Object.freeze({
        deterministic: true,
        key: 'confirmRasterization',
        required: true,
        type: 'boolean',
      }),
    ]),
    output: Object.freeze({
      filenameSuggestion: 'document-redacted.pdf',
      mimeType: 'application/pdf',
    }),
    progressStages: Object.freeze([
      Object.freeze({ cancellable: true, key: 'inspect', label: 'Inspecting removal marks' }),
      Object.freeze({ cancellable: false, key: 'rebuild', label: 'Rebuilding sanitized pages' }),
      Object.freeze({ cancellable: false, key: 'verify', label: 'Verifying permanent removal' }),
    ]),
    provenance,
    version: '0.1.0',
    warningCodes: Object.freeze([
      'ACCESSIBILITY_TAGS_REMOVED',
      'ATTACHMENTS_REMOVED',
      'FORMS_REMOVED',
      'LINKS_AND_ANNOTATIONS_REMOVED',
      'SEARCHABLE_TEXT_REMOVED',
      'SIGNATURES_INVALIDATED',
      'VECTOR_CONTENT_RASTERIZED',
    ]),
  }),
} as const satisfies Readonly<Record<string, PdfOperationContract>>);
