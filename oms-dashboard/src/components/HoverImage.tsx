'use client';

import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Wraps a small product thumbnail and shows an enlarged floating preview on hover.
 * Rendered into <body> via a portal so it's never clipped by table/modal overflow.
 * If `src` is falsy (no image), it just renders the children with no preview.
 */
export default function HoverImage({
  src, alt = '', children, size = 300,
}: { src?: string | null; alt?: string; children: ReactNode; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const open = () => {
    if (!src || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    // Prefer to the right of the thumbnail; flip left if it would overflow.
    let left = r.right + 14;
    if (left + size > window.innerWidth - 12) left = r.left - size - 14;
    left = Math.max(12, Math.min(left, window.innerWidth - size - 12));
    // Vertically centred on the thumbnail, clamped to the viewport.
    let top = r.top + r.height / 2 - size / 2;
    top = Math.max(12, Math.min(top, window.innerHeight - size - 12));
    setPos({ left, top });
  };
  const close = () => setPos(null);

  return (
    <span ref={ref} onMouseEnter={open} onMouseLeave={close} className="inline-flex shrink-0">
      {children}
      {pos && src && typeof document !== 'undefined' && createPortal(
        <div
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: size, height: size, zIndex: 120 }}
          className="pointer-events-none rounded-2xl border border-black/10 bg-white shadow-2xl p-2 animate-in fade-in zoom-in-95 duration-100"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="w-full h-full object-contain rounded-xl" />
        </div>,
        document.body,
      )}
    </span>
  );
}
