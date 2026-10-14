import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { getPublicSite } from '../../lib/public-site';

export const metadata: Metadata = {
  description: 'Published engineering limits for the current PDFrig web and Windows builds.',
  title: 'Known limitations — PDFrig',
};

const limits = [
  [
    'VIEW-008 · EDIT-001 · EDIT-002 · OCR-001',
    'Selecting, adding and editing text',
    'Choose Select text (or Pages) to drag-select source text; focus the page text layer and use Ctrl+A/Ctrl+C to select and copy the current page locally. Copy restrictions are honored. Image-only scans have no text to select; opening a PDF does not run OCR. Added text overlays share point sizes, wrapping, alignment and baselines with export. Overflow or unsupported standard-font characters stop export rather than shrinking, substituting or truncating text. Preview uses Helvetica-compatible system glyphs with matching advance widths; exact glyph outlines can vary by device. Custom fonts, automatic OCR and editing the original text are not implemented. The isolated OCR worker is not connected to file opening and adds a searchable layer, not editable original text.',
  ],
  [
    'SEC-001 · SEC-002 · SEC-003',
    'Protection copies',
    'Add-password and authorized unlock create new local copies within 50 MiB and 500 pages. New passwords support 12–127 printable ASCII characters without substitution. Signed, active, attached-file, XFA, damaged/incremental and unsupported string layouts stop without an export; adding protection also refuses PDF/A and existing extensions. Content, metadata and source objects are verified before returning a copy. Passwords clear after each attempt; authority resets for each source, and changing settings discards results. JavaScript cannot guarantee memory erasure. Inspect saved copies in your reader. Development-gated permission controls use separate owner/open passwords and explicit setting review. An empty open password lets anyone open and extract the file. Flags are reader-enforced requests, not unbreakable DRM, and accessibility extraction is always allowed without certifying accessibility. Production/distribution defaults remain off. No broad-reader or native release certification is claimed.',
  ],
  [
    'CONV-005',
    'Plain-text conversion',
    'One UTF-8 .txt file up to 1 MiB supports printable ASCII, tabs and line breaks only. Invalid encoding, unsupported characters or layouts over 500 pages stop without substitution or truncation. A4/Letter portrait uses Courier 12 pt, 36 pt margins and 15 pt line spacing. Tabs expand at four-column source-line stops, long lines wrap and blank lines remain; markup is literal. Review the actual output before saving. The selectable-text PDF is untagged, not an accessible PDF certification or byte-identical text archive. Rich text, Unicode fonts, custom typography and native release verification remain outside this contract.',
  ],
  [
    'VIEW-001',
    'Local file bounds',
    'The shared viewer currently accepts PDFs up to 50 MB and 500 pages. The Windows bridge streams in chunks, but the PDF engine still assembles a final contiguous buffer.',
  ],
  [
    'VIEW-003',
    'Viewing modes',
    'Zoom, fit, navigation, permanent page rotation, and an app-window presentation view exist. Presentation hides editing chrome and supports visible controls plus Arrow, Page, Home, End, Space, and Escape keys. It does not request browser or operating-system fullscreen, add transitions or timing, provide presenter or multi-monitor tools, or edit the PDF.',
  ],
  [
    'PRINT-001',
    'Standard printing',
    'A local raster preview supports all pages or one comma/range selection at 144 or 216 px/in before opening the browser or Windows print dialog. One preview is bounded to 50 pages, 20 megapixels per page, and 50 megapixels retained in total. Text, links, forms, tags, vectors, colour profiles, and measurement guides are not retained. Printer options and mixed-page scaling belong to the native dialog. Physical printing and Windows print-to-PDF output are not yet fixture-verified; inspect every native preview.',
  ],
  [
    'ORG-001',
    'Complex structures',
    'Organizer export stops on forms, bookmarks, signatures, encryption, tags, attachments, XFA, active content, earlier revisions, and damaged structure when fidelity cannot be established. Page content, resources, annotations, boxes, and rotation are copied into a new PDF, but document-level metadata is not copied.',
  ],
  [
    'CREATE-001',
    'Blank PDF creation',
    'Creates 1–500 identical local blank A4, US Letter, or US Legal pages in portrait or landscape. The selected 0, 36, or 72 point content-safe margin is stored as the standard ArtBox on every page; ordinary readers may not display that guide. The preview represents one page’s geometry. Custom sizes, mixed sizes within one creation, templates, visible guides, and automatic editor opening are not implemented.',
  ],
  [
    'ORG-008',
    'Image insertion',
    'Still PNG, JPEG, and WebP images are supported locally up to 50 MB and 20 megapixels each. EXIF orientation is applied before page creation. WebP and oriented images are normalized to PNG, so their image metadata is not copied. Animated WebP stops safely; choose a still frame first.',
  ],
  [
    'ORG-009 · ORG-010',
    'Crop and resize',
    'Crop changes the visible boundary only; hidden content remains recoverable and it is not redaction. Resize supports one range with fit/fill, but blocks forms, annotations, tags, print-production boxes or metadata, unusual page units, and risky structures. Multiple ranges, direct rendered-page drag handles, and annotation-aware resize are not implemented.',
  ],
  [
    'ORG-011 · ORG-012',
    'Page and Bates numbering',
    'One local range supports basic-Latin visible identifiers. Alphabetic labels use A–Z, AA–ZZ, AAA–ZZZ, not spreadsheet columns. Spaces are literal; control characters are rejected. Identifiers are limited to 120 characters and must fit the page. Unsupported characters or geometry stop export without a partial PDF or report. The sequence preview does not check placement, overlap, or the final count when the last page is unknown. Inspect the exported copy. Page-label mode replaces existing labels only after confirmation; Bates mode preserves them. Multiple ranges, custom fonts, conflict detection, removal, batch folders, and evidence or chain-of-custody claims are not supported.',
  ],
  [
    'EDIT-002',
    'Text changes',
    'Add text creates a new overlay. PDFrig does not yet edit existing PDF text. Exported overlay text currently has a conservative character set.',
  ],
  [
    'EDIT-006',
    'Headers and footers',
    'Basic-Latin text supports page tokens, alignment, size, margins, and custom ranges such as 1,3-5. Review the actual generated PDF before downloading; a settings or file change clears the preview. Unsupported characters, clipped headers, and unusual page geometry stop safely. Advisory checks distinguish ink near estimated text areas from ink elsewhere in full-width margin bands on visited selected pages only. Estimates include spaces and guards, not exact letter shapes. Backgrounds can trigger warnings; faint, tiny, hidden, or unrendered content may be missed. Missing metrics retain the broad warning; oversized or unreadable pages show unavailable, never safe. Always inspect placement manually. Exact overlap detection, custom fonts, and removal are not implemented.',
  ],
  [
    'EDIT-007',
    'Watermarks and backgrounds',
    'Visible text watermarks share custom ranges and the actual-PDF preview, with bounded opacity and angle controls. Margin sampling does not check watermarks; inspect their placement manually. Background replacement, custom fonts, images, background layering, and removal are not implemented. Encrypted, signed, XFA, attached-file, and active-content PDFs stop safely.',
  ],
  [
    'ANNO-003',
    'Eraser',
    'Freehand strokes support whole-mark deletion and bounded partial erasing by pointer or keyboard. The path is resampled and retained segments become separate marks, so inspect the exported copy. Pointer pressure is not retained or claimed.',
  ],
  [
    'ANNO-006',
    'Stamps',
    'Built-in and custom basic-Latin text stamps flatten into a new copy. Optional saving is device-only and bounded to 12 records. Stamps do not prove identity, approval, signature, workflow state, or evidence. Image/dynamic stamps, encrypted asset libraries, import/export, and team sharing are not implemented.',
  ],
  [
    'ANNO-007',
    'Comment reviews',
    'The review ledger covers PDFrig-created local comments, open/resolved status, page/status filters, and a content-bearing JSON summary. It does not import native PDF comments or provide replies, verified identity, assignments, mentions, collaboration, sync, notifications, shared links, or audit/evidence proof.',
  ],
  [
    'ANNO-008',
    'Measurement guides',
    'One guide per page supports calibrated straight-line distance or rectangular area/perimeter. A known reference and uniform scale are required. Precision is display resolution, not accuracy. Guides are session-only and omitted from PDF export/printing. Polygons, polylines, snapping, native measurement objects, persistence, reports, and survey/construction accuracy claims are not supported.',
  ],
  [
    'FORM-001',
    'Forms',
    'Common AcroForm text, checkbox, radio, and dropdown fields are supported. XFA and push-button actions are not.',
  ],
  [
    'SIGN-001',
    'Visual signatures',
    'Typed, drawn, and uploaded marks are visual signatures only. They do not validate identity or create a certificate-backed digital signature.',
  ],
  [
    'OPT-001',
    'Compression',
    'The current local optimizer is lossless structural optimization. It does not promise a smaller file or image-quality presets yet.',
  ],
  [
    'OCR-001',
    'OCR beta',
    'English and French worker fixtures pass locally. Production upload orchestration, quality benchmarks, cost evidence, legal review, and independent security review remain incomplete.',
  ],
  [
    'REDACT-001',
    'Redaction beta',
    'The current method rebuilds the whole document as verified image-only pages, removing search, forms, tags, links, vectors, and signatures. It stays disabled pending broader corpus and independent review.',
  ],
] as const;

export default function KnownLimitationsPage() {
  const { footer, links } = getPublicSite();
  return (
    <PublicPage
      {...footer}
      eyebrow="Current build contract"
      introduction="A working button is not the same as broad PDF support. These limits describe the current evidence and stop public copy from getting ahead of the engines."
      links={links}
      title="What PDFrig does not pretend to do."
    >
      <PublicSection title="Engineering limits by stable feature ID.">
        <div className="limitation-grid">
          {limits.map(([featureId, title, description]) => (
            <article className="limitation-card" key={featureId}>
              <p className="feature-reference">{featureId}</p>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </PublicSection>
      <PublicSection title="Explicitly outside the current product.">
        <p>
          PDFrig does not claim complete professional-suite parity, PDF accessibility or archival
          certification, advanced print-production/preflight, qualified signatures, XFA authoring,
          permanent document management, real-time collaboration, or AI document analysis.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
