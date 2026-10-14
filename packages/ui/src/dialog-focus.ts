import { useEffect, useRef } from 'react';

export const useDialogFocus = (onClose: () => void, restoreFocusTo: HTMLElement | null = null) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus =
      restoreFocusTo ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || dialogRef.current === null) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => {
      globalThis.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, restoreFocusTo]);
  return { closeRef, dialogRef };
};
