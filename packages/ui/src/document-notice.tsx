import { useEffect, useRef, useState, type ReactNode } from 'react';

interface DocumentNoticeProps {
  readonly title: string;
  readonly message: string;
  readonly children?: ReactNode;
}

/** VIEW-001: session-only presentation state, never a permission acknowledgement. */
export const DocumentNotice = (props: DocumentNoticeProps) => (
  <NoticeContent key={props.message} {...props} />
);

const NoticeContent = ({ title, message, children }: DocumentNoticeProps) => {
  const [dismissed, setDismissed] = useState(false);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    (dismissed ? reopenRef : dismissRef).current?.focus();
  }, [dismissed]);
  const toggle = (value: boolean): void => {
    restoreFocus.current = true;
    setDismissed(value);
  };
  if (dismissed)
    return (
      <div className="document-notice-reopen">
        <button onClick={() => toggle(false)} ref={reopenRef} type="button">
          Show document notice
        </button>
      </div>
    );
  return (
    <div className="workspace-warning" role="status">
      <strong>{title}</strong>
      <span>{message}</span>
      <div className="document-notice-actions">
        {children}
        <button
          aria-label="Dismiss document notice"
          onClick={() => toggle(true)}
          ref={dismissRef}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
};
