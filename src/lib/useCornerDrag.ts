import { useRef, useState } from "react";
import type { Pos } from "./useLayout";

const clamp = (p: Pos): Pos => ({
  x: Math.round(Math.min(Math.max(0, p.x), window.innerWidth - 60)),
  y: Math.round(Math.min(Math.max(0, p.y), window.innerHeight - 30)),
});

/**
 * Drag for the ticker + notifications. A press that moves more than a few pixels drags;
 * otherwise it's a normal click. `null` position = the default corner. `onChange` saves it
 * (into the current layout) when the drag ends.
 */
export function useCornerDrag(saved: Pos | null, onChange: (pos: Pos | null) => void) {
  // While dragging: the live position; otherwise the saved one.
  const [live, setLive] = useState<Pos | null>(null);
  const pos = live ?? saved;
  const [dragging, setDragging] = useState(false);
  const justDragged = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const offset = { x: e.clientX - box.left, y: e.clientY - box.top };
    let moved = false;
    let latest: Pos | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      if (!moved) {
        moved = true;
        setDragging(true);
      }
      latest = clamp({ x: ev.clientX - offset.x, y: ev.clientY - offset.y });
      setLive(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) {
        justDragged.current = true;
        setTimeout(() => (justDragged.current = false), 0);
        setDragging(false);
        if (latest) onChange(latest);
        setLive(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Swallows the click that ends a drag, so dropping the ticker doesn't open a thread. */
  const onClickCapture = (e: React.MouseEvent) => {
    if (justDragged.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const reset = () => onChange(null);

  return { pos: pos && clamp(pos), dragging, onPointerDown, onClickCapture, reset };
}
