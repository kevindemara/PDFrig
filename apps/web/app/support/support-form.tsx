'use client';

import { type SyntheticEvent, useState } from 'react';

import { betaIntakeReceiptSchema } from '@pdfmason/contracts';

const formString = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === 'string' ? value : undefined;
};

const optionalFormString = (form: FormData, name: string): string | undefined => {
  const value = formString(form, name)?.trim();
  return value === '' ? undefined : value;
};

export const SupportForm = ({
  applicationVersion,
  enabled,
}: {
  readonly applicationVersion: string;
  readonly enabled: boolean;
}) => {
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSubmitting(true);
    setStatus(null);
    try {
      const response = await fetch('/api/v1/beta/support', {
        body: JSON.stringify({
          applicationVersion,
          category: formString(form, 'category'),
          consentToContact: form.get('consentToContact') === 'on',
          errorCode: optionalFormString(form, 'errorCode'),
          platform: formString(form, 'platform'),
          replyEmail: formString(form, 'replyEmail'),
          requestId: optionalFormString(form, 'requestId'),
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) throw new Error('SUPPORT_INTAKE_FAILED');
      const receipt = betaIntakeReceiptSchema.parse(await response.json());
      formElement.reset();
      setStatus(`Received as ${receipt.reference}. This local adapter did not retain your email.`);
    } catch {
      setStatus('Support intake stopped safely. No document was sent. Try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="support-form" onSubmit={(event) => void submit(event)}>
      <div className="support-form__grid">
        <label>
          Reply email
          <input autoComplete="email" disabled={!enabled} name="replyEmail" required type="email" />
        </label>
        <label>
          Product surface
          <select defaultValue="web" disabled={!enabled} name="platform">
            <option value="web">PDFrig Web</option>
            <option value="windows">PDFrig for Windows</option>
          </select>
        </label>
        <label>
          Help category
          <select defaultValue="local_tool" disabled={!enabled} name="category">
            <option value="local_tool">Local PDF tool</option>
            <option value="cloud_job">Cloud job</option>
            <option value="windows">Windows app</option>
            <option value="account">Account</option>
            <option value="billing">Billing</option>
            <option value="privacy">Privacy</option>
            <option value="accessibility">Accessibility</option>
          </select>
        </label>
        <label>
          Safe error code (optional)
          <input
            autoCapitalize="characters"
            disabled={!enabled}
            maxLength={64}
            name="errorCode"
            pattern="[A-Z][A-Z0-9_]{2,63}"
            placeholder="INPUT_UNSUPPORTED"
          />
        </label>
        <label>
          Request ID (optional)
          <input
            disabled={!enabled}
            maxLength={200}
            minLength={8}
            name="requestId"
            pattern="[A-Za-z0-9_-]+"
            placeholder="Opaque request ID"
          />
        </label>
      </div>
      <label className="support-form__consent">
        <input disabled={!enabled} name="consentToContact" required type="checkbox" />
        PDFrig may use this email to reply about this request. I have not included a filename,
        document text, password, signature, signed URL, or file attachment.
      </label>
      <button className="button button--primary" disabled={!enabled || submitting} type="submit">
        {submitting ? 'Sending safe details…' : 'Send safe diagnostics'}
      </button>
      {!enabled && (
        <p className="draft-notice" role="note">
          The production support provider is not connected. This form is disabled rather than
          pretending a request will be delivered.
        </p>
      )}
      {status !== null && (
        <p className="intake-status" role="status">
          {status}
        </p>
      )}
    </form>
  );
};

export const FeedbackForm = ({
  applicationVersion,
  enabled,
}: {
  readonly applicationVersion: string;
  readonly enabled: boolean;
}) => {
  const [status, setStatus] = useState<string | null>(null);

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/v1/beta/feedback', {
        body: JSON.stringify({
          applicationVersion,
          consentToAggregate: true,
          featureId: formString(form, 'featureId'),
          outcome: formString(form, 'outcome'),
          platform: formString(form, 'platform'),
          rating: Number(formString(form, 'rating')),
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) throw new Error('FEEDBACK_INTAKE_FAILED');
      const receipt = betaIntakeReceiptSchema.parse(await response.json());
      setStatus(`Thanks. Content-free feedback was received as ${receipt.reference}.`);
    } catch {
      setStatus('Feedback was not delivered. No document information was sent.');
    }
  };

  return (
    <form className="feedback-form" onSubmit={(event) => void submit(event)}>
      <input name="platform" type="hidden" value="web" />
      <label>
        Capability
        <select defaultValue="VIEW-001" disabled={!enabled} name="featureId">
          <option value="VIEW-001">Open and render PDFs</option>
          <option value="ORG-003">Reorder pages</option>
          <option value="ANNO-001">Markup</option>
          <option value="ANNO-006">Stamps</option>
          <option value="ANNO-007">Comment review ledger</option>
          <option value="ANNO-008">Calibrated measurement guides</option>
          <option value="FORM-001">Fill forms</option>
          <option value="SIGN-001">Visual signature</option>
          <option value="OPT-001">Compression</option>
          <option value="ORG-009">Crop pages</option>
          <option value="ORG-010">Resize pages</option>
          <option value="ORG-011">Page labels and numbers</option>
          <option value="ORG-012">Bates numbering</option>
          <option value="EDIT-006">Headers and footers</option>
          <option value="EDIT-007">Watermark</option>
        </select>
      </label>
      <label>
        Outcome
        <select defaultValue="completed" disabled={!enabled} name="outcome">
          <option value="completed">Completed the job</option>
          <option value="blocked">Could not finish</option>
          <option value="confusing">Finished, but it was confusing</option>
          <option value="not_started">Did not start</option>
        </select>
      </label>
      <label>
        Experience rating
        <select defaultValue="5" disabled={!enabled} name="rating">
          <option value="5">5 — Clear and dependable</option>
          <option value="4">4 — Good</option>
          <option value="3">3 — Usable</option>
          <option value="2">2 — Difficult</option>
          <option value="1">1 — Blocked</option>
        </select>
      </label>
      <button className="button button--secondary" disabled={!enabled} type="submit">
        Send content-free feedback
      </button>
      {status !== null && (
        <p className="intake-status" role="status">
          {status}
        </p>
      )}
    </form>
  );
};
