import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export function ResizeHandle({
  className = '',
  label,
  value,
  min,
  max,
  step = 16,
  onChange,
  onDraggingChange,
}: Readonly<{
  className?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
}>) {
  const dragOrigin = useRef<{ pointerId: number; clientX: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const change = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next))));
  const setDragState = (next: boolean) => {
    setDragging(next);
    onDraggingChange?.(next);
  };

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current?.pointerId !== event.pointerId) return;
    dragOrigin.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragState(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = value - step;
    if (event.key === 'ArrowRight') next = value + step;
    if (event.key === 'Home') next = min;
    if (event.key === 'End') next = max;
    if (next === null) return;
    event.preventDefault();
    change(next);
  };

  return (
    <div
      className={`resize-handle ${className}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragOrigin.current = { pointerId: event.pointerId, clientX: event.clientX, value };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragState(true);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const origin = dragOrigin.current;
        if (!origin || origin.pointerId !== event.pointerId) return;
        change(origin.value + event.clientX - origin.clientX);
      }}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={(event) => {
        if (dragOrigin.current?.pointerId !== event.pointerId) return;
        dragOrigin.current = null;
        setDragState(false);
      }}
    />
  );
}
