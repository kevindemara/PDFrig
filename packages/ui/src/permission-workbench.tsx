'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createPdfWorkerClient,
  isPermissionPassword,
  LOCAL_PDF_LIMITS,
  type PdfPermissionOptions,
  type PdfWorkerClient,
} from '@pdfmason/pdf-engine/browser';

const permissionControls = [
  ['copying', 'Copy text and images'],
  ['modifying', 'Modify page content'],
  ['annotating', 'Add annotations'],
  ['fillingForms', 'Fill form fields'],
  ['documentAssembly', 'Combine and rearrange pages'],
] as const;
const defaultOptions: PdfPermissionOptions = {
  printing: 'high',
  copying: true,
  modifying: true,
  annotating: true,
  fillingForms: true,
  documentAssembly: true,
};
const safeFailure = (error: unknown): string => {
  const messages: Readonly<Record<string, string>> = {
    UTILITY_PASSWORD_REQUIRED: 'Unlock an authorized copy before setting permissions.',
    UTILITY_PERMISSIONS_PASSWORD_INVALID: 'Choose separate supported owner and open passwords.',
    UTILITY_PERMISSIONS_OPTIONS_INVALID: 'Choose a supported combination of permissions.',
    UTILITY_AUTHORIZATION_REQUIRED: 'Confirm authority for this PDF before changing permissions.',
    UTILITY_INPUT_INVALID: 'Choose a complete, unencrypted PDF within the stated limits.',
    UTILITY_ENCRYPTED_INPUT: 'Unlock an authorized copy before setting permissions.',
    UTILITY_SIGNATURES_BLOCKED:
      'This PDF contains signature structures. Permission changes are blocked.',
    UTILITY_ACTIVE_CONTENT_BLOCKED:
      'This PDF contains active content. Permission changes are blocked.',
    UTILITY_ATTACHMENTS_BLOCKED:
      'This PDF contains attachments that cannot be safely preserved here.',
    UTILITY_XFA_BLOCKED: 'XFA forms are not supported for permission changes.',
    UTILITY_PERMISSIONS_STRING_LAYOUT_BLOCKED:
      'This PDF has a string layout the encryption engine cannot safely protect.',
    UTILITY_PERMISSIONS_EXTENSIONS_BLOCKED:
      'This PDF declares extensions that are not verified for encryption.',
    UTILITY_PDFA_ENCRYPTION_BLOCKED:
      'PDF/A does not permit encryption. No permission copy was made.',
    UTILITY_PERMISSIONS_PAGE_LIMIT: 'Choose a PDF with at most 500 pages.',
    UTILITY_PDF_MALFORMED:
      'This PDF has damaged or incomplete structure. No permission copy was made.',
    UTILITY_INCREMENTAL_REVISIONS_BLOCKED:
      'This PDF has multiple revisions. Permission changes are blocked.',
  };
  return `${messages[error instanceof Error ? error.message : ''] ?? 'Permission output could not be verified. Try a supported PDF.'} Your original is unchanged.`;
};

/** SEC-003: shared, source-bound authority and disposable credentials/results. */
export const PermissionWorkbench = ({ createWorker }: { readonly createWorker?: () => Worker }) => {
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState(defaultOptions);
  const [ownerPassword, setOwnerPassword] = useState('');
  const [openPassword, setOpenPassword] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [result, setResult] = useState<{
    readonly bytes: Uint8Array;
    readonly requiresOpenPassword: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('Choose an unencrypted PDF to begin.');
  const generation = useRef(0);
  const inFlight = useRef(false);
  const client = useRef<PdfWorkerClient | null>(null);
  const release = (): void => {
    generation.current += 1;
    inFlight.current = false;
    client.current?.terminate();
    client.current = null;
  };
  useEffect(() => release, []);
  const invalidate = (): void => {
    release();
    setResult(null);
    setReviewed(false);
    setConfirmed(false);
    setBusy(false);
    setFailed(false);
    setMessage('Settings changed. Review and create a new permission copy.');
  };
  const passwordsValid =
    isPermissionPassword(ownerPassword) &&
    isPermissionPassword(openPassword, true) &&
    ownerPassword !== openPassword;
  const canCreate =
    file !== null &&
    passwordsValid &&
    authorized &&
    confirmed &&
    !busy &&
    createWorker !== undefined;
  const build = async (): Promise<void> => {
    if (!canCreate || inFlight.current) return;
    release();
    const request = generation.current;
    const current = () => request === generation.current;
    inFlight.current = true;
    setResult(null);
    setReviewed(false);
    setBusy(true);
    setFailed(false);
    setMessage('Encrypting and verifying the new copy on this device…');
    try {
      const worker = createPdfWorkerClient(createWorker());
      client.current = worker;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!current()) return;
      const output = await worker.setPermissions(
        bytes,
        options,
        ownerPassword,
        openPassword,
        authorized,
      );
      if (!current()) return;
      setResult({ bytes: output, requiresOpenPassword: openPassword !== '' });
      setMessage('Permission copy verified. Review the selected permissions before saving.');
    } catch (error: unknown) {
      if (!current()) return;
      setResult(null);
      setFailed(true);
      setMessage(safeFailure(error));
    } finally {
      // A stale attempt must not erase credentials entered for a replacement.
      if (current()) {
        release();
        setBusy(false);
        setOwnerPassword('');
        setOpenPassword('');
      }
    }
  };
  const download = (): void => {
    if (result === null || !reviewed || busy || inFlight.current) return;
    const url = URL.createObjectURL(
      new Blob([result.bytes.slice().buffer], { type: 'application/pdf' }),
    );
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'pdfmason-permissions.pdf';
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    setMessage('New permission copy downloaded. Your original is unchanged.');
  };

  return (
    <div className="decoration-workbench">
      <label className="utility-dropzone">
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            invalidate();
            setAuthorized(false);
            setOwnerPassword('');
            setOpenPassword('');
            const chosen = event.currentTarget.files?.[0];
            if (chosen === undefined) {
              setFile(null);
              setMessage('Choose an unencrypted PDF to begin.');
              return;
            }
            if (
              (chosen.type !== '' && chosen.type !== 'application/pdf') ||
              !/\.pdf$/iu.test(chosen.name) ||
              chosen.size < 1 ||
              chosen.size > LOCAL_PDF_LIMITS.maximumBytes
            ) {
              setFile(null);
              setFailed(true);
              setMessage('Choose one non-empty PDF up to 50 MB. Your original is unchanged.');
              return;
            }
            setFile(chosen);
            setMessage('PDF ready. Set password roles and review permissions.');
          }}
        />
        <span className="utility-dropzone__mark" aria-hidden="true">
          +
        </span>
        <strong>Choose an unencrypted PDF</strong>
        <span>One PDF · up to 50 MB and 500 pages · never uploaded</span>
      </label>
      <div className="metadata-grid">
        <label className="field-label">
          Owner password
          <input
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            aria-describedby="permission-password-help"
            value={ownerPassword}
            onChange={(event) => {
              invalidate();
              setOwnerPassword(event.currentTarget.value);
            }}
          />
        </label>
        <label className="field-label">
          Open password (optional)
          <input
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            aria-describedby="permission-password-help"
            value={openPassword}
            onChange={(event) => {
              invalidate();
              setOpenPassword(event.currentTarget.value);
            }}
          />
        </label>
      </div>
      <p className="fidelity-note" id="permission-password-help">
        Owner password controls permissions in compatible readers; keep it private. The optional
        open password is for readers opening the file. Each password must be different and contain
        12–127 printable ASCII characters. Use long, unique passwords; length alone does not
        guarantee strength. Passwords stay in active memory and clear after each attempt. Memory
        erasure cannot be guaranteed.
      </p>
      <fieldset className="utility-options">
        <legend>Reader permissions</legend>
        <label className="field-label">
          Printing permission
          <select
            value={options.printing}
            onChange={(event) => {
              invalidate();
              setOptions({
                ...options,
                printing: event.currentTarget.value as PdfPermissionOptions['printing'],
              });
            }}
          >
            <option value="none">Not allowed</option>
            <option value="low">Low resolution only</option>
            <option value="high">Full resolution</option>
          </select>
        </label>
        {permissionControls.map(([key, label]) => (
          <label className="authorization-check" key={key}>
            <input
              type="checkbox"
              checked={options[key]}
              onChange={(event) => {
                invalidate();
                const checked = event.currentTarget.checked;
                setOptions({
                  ...options,
                  [key]: checked,
                  ...(key === 'annotating' && checked ? { fillingForms: true } : {}),
                  ...(key === 'fillingForms' && !checked ? { annotating: false } : {}),
                });
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <section className="numbering-preview" aria-label="Permission review">
        <p className="eyebrow">Selected reader permissions</p>
        <ul>
          <li>
            Printing:{' '}
            {options.printing === 'high'
              ? 'full resolution'
              : options.printing === 'low'
                ? 'low resolution'
                : 'not allowed'}
          </li>
          {permissionControls.map(([key, label]) => (
            <li key={key}>
              {label}: {options[key] ? 'allowed' : 'not allowed'}
            </li>
          ))}
          <li>Accessibility extraction: always allowed</li>
        </ul>
      </section>
      <p className="fidelity-note">
        Permission flags are requests to compatible readers, not unbreakable DRM. They do not
        reliably prevent copying, editing or extraction. Without an open password, anyone can open
        and extract the document. Allowing accessibility extraction does not certify the PDF as
        accessible. Enabling annotations also enables form filling; disabling form filling also
        disables annotations.
      </p>
      <p className="fidelity-note">
        Runs on this device with AES-256. Existing encryption, signatures, XFA, attachments, active
        content, multiple revisions, PDF/A and unverifiable string layouts stop safely. No source is
        overwritten. The output PDF version may increase to support encryption.
      </p>
      <label className="authorization-check">
        <input
          type="checkbox"
          checked={authorized}
          onChange={(event) => {
            invalidate();
            setAuthorized(event.currentTarget.checked);
          }}
        />
        I am authorized to set this document’s permissions.
      </label>
      <label className="authorization-check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => {
            setConfirmed(event.currentTarget.checked);
          }}
          disabled={busy || result !== null}
        />
        I reviewed the password roles and understand the permission limitations.
      </label>
      <div className="decoration-preview-actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!canCreate}
          onClick={() => void build()}
        >
          Create permission copy
        </button>
        {busy && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              invalidate();
              setOwnerPassword('');
              setOpenPassword('');
              setMessage('Permission changes cancelled. Your original is unchanged.');
            }}
          >
            Cancel permission changes
          </button>
        )}
      </div>
      {result !== null && (
        <>
          <p className="fidelity-note">
            Passwords were cleared from the controls. The new copy
            {result.requiresOpenPassword
              ? ' requires the selected open password.'
              : ' has no open password; anyone can open and extract it.'}
          </p>
          <label className="authorization-check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.currentTarget.checked)}
            />
            I reviewed these permissions and will keep the owner password private.
          </label>
          <button
            type="button"
            className="button button--primary"
            disabled={!reviewed || busy}
            onClick={download}
          >
            Download reviewed permission copy
          </button>
        </>
      )}
      <p className="utility-status" role={failed ? 'alert' : 'status'}>
        {message}
      </p>
    </div>
  );
};
