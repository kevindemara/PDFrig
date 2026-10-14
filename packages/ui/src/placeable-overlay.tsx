import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { NormalizedRect } from '@pdfmason/editor-core';

const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof handles)[number];
const labels: Readonly<Record<Handle, string>> = {
  nw: 'top left',
  n: 'top',
  ne: 'top right',
  e: 'right',
  se: 'bottom right',
  s: 'bottom',
  sw: 'bottom left',
  w: 'left',
};
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const rectChanged = (before: NormalizedRect, after: NormalizedRect): boolean =>
  (['x', 'y', 'width', 'height'] as const).some(
    (key) => Math.abs(before[key] - after[key]) > 1e-10,
  );

// EDIT-001, ANNO-001/002/003/004/005/006, SIGN-001/002: displayed-page geometry.
export const transformPlaceableRect = (
  rect: NormalizedRect,
  mode: Handle | 'move',
  dx: number,
  dy: number,
): NormalizedRect => {
  if (mode === 'move')
    return {
      ...rect,
      x: clamp(rect.x + dx, 0, 1 - rect.width),
      y: clamp(rect.y + dy, 0, 1 - rect.height),
    };
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  const minimumWidth = Math.min(0.02, rect.width);
  const minimumHeight = Math.min(0.02, rect.height);
  if (mode.includes('w')) left = clamp(left + dx, 0, right - minimumWidth);
  if (mode.includes('e')) right = clamp(right + dx, left + minimumWidth, 1);
  if (mode.includes('n')) top = clamp(top + dy, 0, bottom - minimumHeight);
  if (mode.includes('s')) bottom = clamp(bottom + dy, top + minimumHeight, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
};

interface Drag {
  readonly scope: string;
  readonly pointerId: number;
  readonly mode: Handle | 'move';
  readonly x: number;
  readonly y: number;
  readonly bounds: DOMRect;
  readonly page: HTMLElement;
}

export const PlaceableOverlay = ({
  rect: committedRect,
  name,
  resizeName = name,
  className = '',
  bodyClassName,
  bodyStyle,
  children,
  selected,
  disabled,
  scope,
  onSelect,
  onCommit,
  onKeyDown,
}: {
  readonly rect: NormalizedRect;
  readonly name: string;
  readonly resizeName?: string;
  readonly className?: string;
  readonly bodyClassName: string;
  readonly bodyStyle?: CSSProperties;
  readonly children: (rect: NormalizedRect) => ReactNode;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly scope: string;
  readonly onSelect: () => void;
  readonly onCommit: (rect: NormalizedRect) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<{ scope: string; rect: NormalizedRect } | null>(null);
  const rect = preview?.scope === scope ? preview.rect : committedRect;
  const cancel = (): void => {
    drag.current = null;
    setPreview(null);
  };
  const begin = (event: PointerEvent<HTMLButtonElement>, mode: Handle | 'move'): void => {
    event.stopPropagation();
    if (disabled || event.button !== 0 || !event.isPrimary) return;
    if (drag.current?.scope === scope) return;
    const page = root.current?.parentElement;
    if (page === null || page === undefined) return;
    const bounds = page.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      scope,
      pointerId: event.pointerId,
      mode,
      x: event.clientX,
      y: event.clientY,
      bounds,
      page,
    };
    onSelect();
  };
  const nextRect = (event: PointerEvent<HTMLButtonElement>): NormalizedRect | null => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return null;
    if (disabled || current.scope !== scope) {
      cancel();
      return null;
    }
    const bounds = current.page.getBoundingClientRect();
    // A scroll, responsive resize or page render invalidates the captured geometry.
    if (
      (['x', 'y', 'width', 'height'] as const).some((key) => bounds[key] !== current.bounds[key])
    ) {
      cancel();
      return null;
    }
    return transformPlaceableRect(
      committedRect,
      current.mode,
      (event.clientX - current.x) / bounds.width,
      (event.clientY - current.y) / bounds.height,
    );
  };
  const pointerEvents = {
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const next = nextRect(event);
      if (next !== null) setPreview({ scope, rect: next });
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const next = nextRect(event);
      if (next === null) return;
      cancel();
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      if (rectChanged(committedRect, next)) onCommit(next);
    },
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (drag.current?.pointerId === event.pointerId) cancel();
    },
    onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => {
      if (drag.current?.pointerId === event.pointerId) cancel();
    },
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, mode: Handle | 'move'): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (disabled || drag.current?.scope === scope) return;
    if (mode === 'move') {
      onKeyDown(event);
      return;
    }
    const step = event.shiftKey ? 0.01 : 0.001;
    const delta: Readonly<Record<string, readonly [number, number]>> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const movement = delta[event.key];
    if (movement !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      const next = transformPlaceableRect(committedRect, mode, ...movement);
      if (rectChanged(committedRect, next)) onCommit(next);
    }
  };
  return (
    <div
      className={`placeable-overlay ${className}${selected ? ' is-selected' : ''}`}
      ref={root}
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`,
      }}
    >
      <button
        {...pointerEvents}
        onPointerDown={(event) => begin(event, 'move')}
        disabled={disabled}
        aria-label={`${name}. Drag to move; Arrow keys move it; Delete removes it.`}
        className={`annotation-item ${bodyClassName}${selected ? ' is-selected' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onKeyDown={(event) => keyDown(event, 'move')}
        type="button"
        style={bodyStyle}
      >
        {children(rect)}
      </button>
      {selected &&
        handles.map((handle) => (
          <button
            {...pointerEvents}
            onPointerDown={(event) => begin(event, handle)}
            disabled={disabled}
            aria-label={`Resize ${resizeName} ${labels[handle]}. Arrow keys resize; Shift for larger steps.`}
            className={`overlay-resize-handle text-resize-handle text-resize-handle--${handle}`}
            key={handle}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => keyDown(event, handle)}
            title={`Drag to resize ${labels[handle]}`}
            type="button"
          />
        ))}
    </div>
  );
};
