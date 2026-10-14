import { useEffect, useRef, useState } from 'react';
import type { NormalizedPoint } from '@pdfmason/editor-core';

export interface PointerDraft {
  readonly bounds?: Pick<DOMRect, 'x' | 'y' | 'width' | 'height'> | undefined;
  readonly current: NormalizedPoint;
  readonly pointerId: number;
  readonly points: readonly NormalizedPoint[];
  readonly scope: string;
  readonly start: NormalizedPoint;
}

// ANNO-003: input events must not depend on when React commits the preview.
export const usePointerGesture = (scope: string) => {
  const current = useRef<PointerDraft | null>(null);
  const [preview, setPreview] = useState<PointerDraft | null>(null);
  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || current.current?.scope !== scope) return;
      event.preventDefault();
      current.current = null;
      setPreview(null);
    };
    globalThis.addEventListener('keydown', cancelOnEscape);
    return () => globalThis.removeEventListener('keydown', cancelOnEscape);
  }, [scope]);
  const publish = (draft: PointerDraft | null): void => {
    current.current = draft;
    setPreview(draft);
  };
  return {
    draft: preview?.scope === scope ? preview : null,
    begin(point: NormalizedPoint, pointerId: number, bounds?: DOMRect): boolean {
      if (current.current !== null && current.current.scope === scope) return false;
      publish({ current: point, pointerId, points: [point], scope, start: point, bounds });
      return true;
    },
    move(
      point: NormalizedPoint,
      pointerId: number,
      collect: boolean,
      bounds?: DOMRect,
    ): 'updated' | 'ignored' | 'cancelled' | 'limit' {
      const draft = current.current;
      if (draft?.pointerId !== pointerId || draft.scope !== scope) return 'ignored';
      if (
        draft.bounds !== undefined &&
        (bounds === undefined ||
          (['x', 'y', 'width', 'height'] as const).some(
            (key) => draft.bounds?.[key] !== bounds[key],
          ))
      ) {
        publish(null);
        return 'cancelled';
      }
      // The worker accepts 2000 points; reserve one for the final pointer-up point.
      // Refuse the entire over-limit gesture rather than silently truncate artwork.
      if (collect && draft.points.length >= 1999) {
        publish(null);
        return 'limit';
      }
      publish({
        ...draft,
        current: point,
        points: collect ? [...draft.points, point] : draft.points,
      });
      return 'updated';
    },
    finish(pointerId: number, bounds?: DOMRect): PointerDraft | null {
      const draft = current.current;
      if (draft?.pointerId !== pointerId) return null;
      publish(null);
      if (
        draft.bounds !== undefined &&
        (bounds === undefined ||
          (['x', 'y', 'width', 'height'] as const).some(
            (key) => draft.bounds?.[key] !== bounds[key],
          ))
      )
        return null;
      return draft.scope === scope ? draft : null;
    },
    cancel(pointerId: number): void {
      if (current.current?.pointerId === pointerId) publish(null);
    },
  };
};
