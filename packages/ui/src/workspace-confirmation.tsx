import { useCallback, useEffect, useRef, useState } from 'react';
import { useDialogFocus } from './dialog-focus.js';

interface PendingConfirmation {
  readonly message: string;
  readonly restoreFocusTo: HTMLElement | null;
  readonly resolve: (confirmed: boolean) => void;
}

const WorkspaceConfirmationDialog = ({
  message,
  onCancel,
  onConfirm,
  restoreFocusTo,
}: Pick<PendingConfirmation, 'message' | 'restoreFocusTo'> & {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) => {
  const { closeRef, dialogRef } = useDialogFocus(onCancel, restoreFocusTo);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-describedby="workspace-confirmation-description"
        aria-labelledby="workspace-confirmation-title"
        aria-modal="true"
        className="editor-dialog"
        ref={dialogRef}
        role="alertdialog"
      >
        <div className="dialog-heading">
          <h2 id="workspace-confirmation-title">Discard unsaved work?</h2>
          <button
            className="button button--secondary"
            onClick={onCancel}
            ref={closeRef}
            type="button"
          >
            Cancel
          </button>
        </div>
        <p id="workspace-confirmation-description">{message}</p>
        <div className="dialog-actions">
          <button className="button button--primary" onClick={onConfirm} type="button">
            Discard and continue
          </button>
        </div>
      </section>
    </div>
  );
};

/** In-app UI: Tauri replaces window.confirm with an async, permission-gated API. */
export const useWorkspaceConfirmation = () => {
  const pendingRef = useRef<PendingConfirmation | null>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const finish = useCallback((confirmed: boolean): void => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(confirmed);
  }, []);
  const onCancel = useCallback(() => finish(false), [finish]);
  const onConfirm = useCallback(() => finish(true), [finish]);
  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );
  const requestConfirmation = useCallback((message: string): Promise<boolean> => {
    if (pendingRef.current !== null) return Promise.resolve(false);
    return new Promise((resolve) => {
      const next = {
        message,
        resolve,
        restoreFocusTo:
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
      };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);
  return {
    requestConfirmation,
    confirmation:
      pending === null ? null : (
        <WorkspaceConfirmationDialog {...pending} onCancel={onCancel} onConfirm={onConfirm} />
      ),
  };
};
