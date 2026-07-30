"use client";

import { useCallback, useRef, useState } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tracks an element's rendered size so SVG/canvas work can be laid out in real
 * pixels instead of a hardcoded viewBox.
 *
 * Returns a *callback* ref rather than an object ref on purpose: the measured
 * element usually sits behind a loading branch, so a `useEffect(..., [])` would
 * run while the node is still unmounted, find nothing to observe, and never run
 * again — leaving the size stuck at 0. A callback ref attaches the observer at
 * the moment the node appears, however late that is.
 *
 * The initial measurement comes from ResizeObserver itself (it fires once on
 * `observe()`), so there's no synchronous setState and no first-paint flash.
 */
export function useElementSize<T extends HTMLElement>(): [
  (node: T | null) => void,
  ElementSize,
] {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    // React calls the callback with null on unmount, so the disconnect above
    // doubles as cleanup.
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((current) =>
        Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
          ? current
          : { width, height }
      );
    });

    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return [ref, size];
}
