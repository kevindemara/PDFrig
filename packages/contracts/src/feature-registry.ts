export type FeaturePriority = 'L' | 'N' | 'P' | 'O';
export type FeatureState =
  | 'catalogued'
  | 'researched'
  | 'engine_selected'
  | 'implemented'
  | 'fixture_verified'
  | 'beta'
  | 'verified';

export interface FeatureDefinition {
  readonly id: string;
  readonly name: string;
  readonly priority: FeaturePriority;
  readonly state: FeatureState;
  readonly target: string;
}

const feature = (
  id: string,
  name: string,
  priority: FeaturePriority,
  target: string,
  state: FeatureState = 'catalogued',
): FeatureDefinition => ({ id, name, priority, state, target });

/**
 * Product-scope authority mirrored from docs/product-scope.json.
 * Engineering state advances only when milestone evidence names the stable ID.
 */
export const FEATURE_REGISTRY = {
  'VIEW-001': feature('VIEW-001', 'Open and render PDFs', 'L', 'Launch', 'fixture_verified'),
  'VIEW-002': feature(
    'VIEW-002',
    'Password-protected PDF opening',
    'L',
    'Launch',
    'fixture_verified',
  ),
  'VIEW-003': feature(
    'VIEW-003',
    'Zoom, fit, rotate view, and presentation modes',
    'L',
    'Launch',
    'fixture_verified',
  ),
  'VIEW-004': feature(
    'VIEW-004',
    'Thumbnails and page navigation',
    'L',
    'Launch',
    'fixture_verified',
  ),
  'VIEW-005': feature(
    'VIEW-005',
    'Text search and result navigation',
    'L',
    'Launch',
    'fixture_verified',
  ),
  'VIEW-006': feature(
    'VIEW-006',
    'Outline and bookmark navigation',
    'N',
    'Phase 2',
    'fixture_verified',
  ),
  'VIEW-007': feature(
    'VIEW-007',
    'Attachments and layers read-only inspection',
    'P',
    'Phase 3',
    'fixture_verified',
  ),
  'VIEW-008': feature(
    'VIEW-008',
    'Select and copy existing document text',
    'N',
    'Next local milestone',
    'implemented',
  ),
  'PRINT-001': feature(
    'PRINT-001',
    'Standard print and print-range controls',
    'L',
    'Launch',
    'implemented',
  ),
  'PRINT-002': feature('PRINT-002', 'Booklet and multi-page printing', 'P', 'Phase 3'),
  'PRINT-003': feature('PRINT-003', 'PDFrig virtual printer', 'P', 'Phase 3'),
  'ORG-001': feature('ORG-001', 'Merge PDFs', 'L', 'Launch', 'fixture_verified'),
  'ORG-002': feature('ORG-002', 'Split PDFs', 'L', 'Launch', 'fixture_verified'),
  'ORG-003': feature('ORG-003', 'Reorder pages', 'L', 'Launch', 'fixture_verified'),
  'ORG-004': feature('ORG-004', 'Rotate pages permanently', 'L', 'Launch', 'fixture_verified'),
  'ORG-005': feature('ORG-005', 'Delete and duplicate pages', 'L', 'Launch', 'fixture_verified'),
  'ORG-006': feature('ORG-006', 'Extract selected pages', 'L', 'Launch', 'fixture_verified'),
  'ORG-007': feature('ORG-007', 'Insert PDF pages', 'L', 'Launch', 'fixture_verified'),
  'ORG-008': feature('ORG-008', 'Insert images as pages', 'L', 'Launch', 'fixture_verified'),
  'ORG-009': feature('ORG-009', 'Crop pages', 'N', 'Phase 2', 'fixture_verified'),
  'ORG-010': feature('ORG-010', 'Resize pages', 'N', 'Phase 2', 'fixture_verified'),
  'ORG-011': feature(
    'ORG-011',
    'Add page labels and page numbers',
    'N',
    'Phase 2',
    'fixture_verified',
  ),
  'ORG-012': feature('ORG-012', 'Bates numbering', 'P', 'Phase 3', 'fixture_verified'),
  'CREATE-001': feature('CREATE-001', 'Create a blank PDF', 'L', 'Launch', 'fixture_verified'),
  'CREATE-002': feature('CREATE-002', 'Images to PDF', 'L', 'Launch', 'fixture_verified'),
  'CREATE-003': feature('CREATE-003', 'Scan to PDF in Windows', 'N', 'Phase 2'),
  'CONV-001': feature('CONV-001', 'PDF pages to PNG or JPEG', 'L', 'Launch', 'fixture_verified'),
  'CONV-002': feature('CONV-002', 'Word to PDF', 'N', 'Paid beta', 'fixture_verified'),
  'CONV-003': feature('CONV-003', 'Excel to PDF', 'N', 'Paid beta', 'fixture_verified'),
  'CONV-004': feature('CONV-004', 'PowerPoint to PDF', 'N', 'Paid beta', 'fixture_verified'),
  'CONV-005': feature(
    'CONV-005',
    'Common image and text files to PDF',
    'N',
    'Phase 2',
    'implemented',
  ),
  'CONV-006': feature('CONV-006', 'PDF to Word', 'P', 'Phase 3'),
  'CONV-007': feature('CONV-007', 'PDF to Excel', 'P', 'Phase 3'),
  'CONV-008': feature('CONV-008', 'PDF to PowerPoint', 'P', 'Phase 3'),
  'OCR-001': feature('OCR-001', 'OCR to searchable PDF', 'N', 'Paid beta', 'fixture_verified'),
  'OCR-002': feature('OCR-002', 'OCR selected pages', 'P', 'Phase 3'),
  'OCR-003': feature('OCR-003', 'Local Windows OCR', 'P', 'Phase 3'),
  'EDIT-001': feature('EDIT-001', 'Add text overlay', 'L', 'Launch', 'fixture_verified'),
  'EDIT-002': feature('EDIT-002', 'Edit existing PDF text', 'N', 'Phase 2', 'fixture_verified'),
  'EDIT-003': feature('EDIT-003', 'Edit images', 'N', 'Phase 2'),
  'EDIT-004': feature('EDIT-004', 'Add and edit links', 'N', 'Phase 2'),
  'EDIT-005': feature('EDIT-005', 'Add simple shapes and objects', 'N', 'Phase 2'),
  'EDIT-006': feature('EDIT-006', 'Headers and footers', 'N', 'Phase 2', 'implemented'),
  'EDIT-007': feature('EDIT-007', 'Watermarks and backgrounds', 'N', 'Phase 2', 'engine_selected'),
  'EDIT-008': feature('EDIT-008', 'Find and replace text', 'P', 'Phase 3'),
  'ANNO-001': feature(
    'ANNO-001',
    'Highlight, underline, and strikeout',
    'L',
    'Launch',
    'fixture_verified',
  ),
  'ANNO-002': feature('ANNO-002', 'Sticky notes and comments', 'L', 'Launch', 'fixture_verified'),
  'ANNO-003': feature('ANNO-003', 'Freehand drawing and eraser', 'L', 'Launch', 'fixture_verified'),
  'ANNO-004': feature(
    'ANNO-004',
    'Rectangle, ellipse, line, and arrow',
    'L',
    'Launch',
    'fixture_verified',
  ),
  'ANNO-005': feature('ANNO-005', 'Text boxes and callouts', 'L', 'Launch', 'fixture_verified'),
  'ANNO-006': feature('ANNO-006', 'Stamps and custom stamps', 'N', 'Phase 2', 'fixture_verified'),
  'ANNO-007': feature('ANNO-007', 'Comment list and export', 'N', 'Phase 2', 'fixture_verified'),
  'ANNO-008': feature(
    'ANNO-008',
    'Distance, perimeter, and area measurement',
    'P',
    'Phase 3',
    'implemented',
  ),
  'COMPARE-001': feature('COMPARE-001', 'Compare PDFs', 'P', 'Phase 3'),
  'FORM-001': feature('FORM-001', 'Fill existing AcroForm fields', 'L', 'Launch', 'implemented'),
  'FORM-002': feature(
    'FORM-002',
    'Save and export filled forms',
    'L',
    'Launch',
    'fixture_verified',
  ),
  'FORM-003': feature('FORM-003', 'Import and export form data', 'N', 'Phase 2', 'implemented'),
  'FORM-004': feature('FORM-004', 'Create and edit AcroForm fields', 'N', 'Phase 2'),
  'FORM-005': feature('FORM-005', 'Automatic field detection', 'P', 'Phase 3'),
  'FORM-006': feature('FORM-006', 'Form calculations and validation', 'P', 'Phase 3'),
  'FORM-007': feature('FORM-007', 'Flatten forms', 'L', 'Launch', 'fixture_verified'),
  'SIGN-001': feature('SIGN-001', 'Add a visual signature', 'L', 'Launch', 'fixture_verified'),
  'SIGN-002': feature(
    'SIGN-002',
    'Initials, date, checkmark, and saved assets',
    'L',
    'Launch',
    'implemented',
  ),
  'SIGN-003': feature(
    'SIGN-003',
    'Place signature on multiple pages',
    'N',
    'Phase 2',
    'implemented',
  ),
  'ESIGN-001': feature('ESIGN-001', 'Request signatures', 'P', 'Phase 3'),
  'ESIGN-002': feature('ESIGN-002', 'Signature status and audit package', 'P', 'Phase 3'),
  'SEC-001': feature('SEC-001', 'Add an open password', 'L', 'Launch', 'fixture_verified'),
  'SEC-002': feature(
    'SEC-002',
    'Remove encryption with authorization',
    'L',
    'Launch',
    'fixture_verified',
  ),
  'SEC-003': feature('SEC-003', 'Set PDF permission flags', 'N', 'Phase 2', 'implemented'),
  'SEC-004': feature(
    'SEC-004',
    'View, edit, and remove metadata',
    'L',
    'Launch',
    'fixture_verified',
  ),
  'SEC-005': feature('SEC-005', 'Remove hidden metadata and content', 'N', 'Phase 2'),
  'REDACT-001': feature(
    'REDACT-001',
    'Apply irreversible redaction',
    'N',
    'Verified beta',
    'fixture_verified',
  ),
  'REDACT-002': feature('REDACT-002', 'Search and redact', 'P', 'Phase 3'),
  'REDACT-003': feature('REDACT-003', 'Redaction labels and report', 'P', 'Phase 3'),
  'SEC-006': feature('SEC-006', 'Safe active-content handling', 'L', 'Launch', 'fixture_verified'),
  'SEC-007': feature('SEC-007', 'Detect existing signatures', 'N', 'Phase 2', 'implemented'),
  'OPT-001': feature('OPT-001', 'Compression presets', 'L', 'Launch', 'fixture_verified'),
  'OPT-002': feature('OPT-002', 'Advanced optimizer', 'N', 'Phase 2'),
  'OPT-003': feature('OPT-003', 'Linearize for fast web view', 'N', 'Phase 2'),
  'BATCH-001': feature('BATCH-001', 'Batch actions', 'N', 'Phase 2'),
  'BATCH-002': feature('BATCH-002', 'Reusable action presets', 'P', 'Phase 3'),
  'BATCH-003': feature('BATCH-003', 'Watched folders in Windows', 'P', 'Phase 3'),
  'SHARE-001': feature('SHARE-001', 'Expiring review links', 'P', 'Phase 3'),
  'SHARE-002': feature('SHARE-002', 'Browser review comments', 'P', 'Phase 3'),
  'SHARE-003': feature('SHARE-003', 'Shared-review version history', 'P', 'Phase 3'),
  'INT-001': feature('INT-001', 'Google Drive integration', 'P', 'Phase 3'),
  'INT-002': feature('INT-002', 'Microsoft OneDrive integration', 'P', 'Phase 3'),
  'INT-003': feature('INT-003', 'Dropbox integration', 'P', 'Phase 3'),
  'TEAM-001': feature('TEAM-001', 'Team seats and roles', 'P', 'Phase 3'),
  'TEAM-002': feature('TEAM-002', 'Shared stamps and settings', 'P', 'Phase 3'),
  'A11Y-001': feature('A11Y-001', 'Accessibility checker', 'P', 'Phase 3'),
  'A11Y-002': feature('A11Y-002', 'Auto-tagging suggestions', 'P', 'Phase 3'),
  'A11Y-003': feature('A11Y-003', 'Alt text and document language', 'N', 'Phase 2'),
  'STD-001': feature('STD-001', 'PDF/A conversion and validation', 'P', 'Phase 3'),
  'AI-001': feature('AI-001', 'Opt-in document summary', 'O', 'Separate discovery'),
  'AI-002': feature('AI-002', 'Opt-in grounded questions', 'O', 'Separate discovery'),
} as const satisfies Readonly<Record<string, FeatureDefinition>>;

export type FeatureId = keyof typeof FEATURE_REGISTRY;

export const FEATURE_IDS = Object.freeze(Object.keys(FEATURE_REGISTRY) as FeatureId[]);

export const isFeatureId = (value: string): value is FeatureId => value in FEATURE_REGISTRY;
