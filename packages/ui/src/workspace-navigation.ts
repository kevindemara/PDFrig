import type { EditorDocumentState, SessionSnapshot } from '@pdfmason/editor-core';

/** Exported PDFs do not contain session-only guides or unapplied removal marks. */
export const hasUnsavedWorkspaceWork = (
  snapshot: SessionSnapshot<EditorDocumentState> | undefined,
  redactionMarkCount: number,
): boolean =>
  snapshot?.exported === false ||
  redactionMarkCount > 0 ||
  (snapshot?.state.measurements.length ?? 0) > 0;

export const confirmWorkspaceNavigation = async (
  unsaved: boolean,
  confirmLeave: (message: string) => boolean | Promise<boolean>,
): Promise<boolean> =>
  !unsaved ||
  (await confirmLeave(
    'Leave the editor? Changes that have not been exported, unapplied redaction marks and session-only measurement guides will be lost. Choose Cancel to stay and export your work first. Your original PDF and already exported files will not change.',
  ));
