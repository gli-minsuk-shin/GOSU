import { useRef, useState, type DragEvent } from 'react';
import './chat-file-drop.css';

export function isFileDrag(event: Pick<DragEvent, 'dataTransfer'>) {
  return Array.from(event.dataTransfer.types).includes('Files');
}
export function useChatFileDrop(enabled: boolean, attach: (files: File[]) => Promise<void>) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  return {
    dragging,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current++;
        if (enabled) setDragging(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = enabled ? 'copy' : 'none';
      },
      onDragLeave: (event: DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      },
      onDrop: (event: DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current = 0;
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (enabled && files.length) void attach(files);
      },
    },
  };
}
