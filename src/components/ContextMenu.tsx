import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/**
 * A right-click menu in the overlay's own glass style. Closes on Esc, on a click
 * anywhere else in the overlay, or shortly after the pointer leaves it.
 */
export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  const leaveTimer = useRef<number | undefined>(undefined);

  // Keep it on screen.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPos({
      x: Math.min(menu.x, window.innerWidth - box.width - 8),
      y: Math.min(menu.y, window.innerHeight - box.height - 8),
    });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(leaveTimer.current);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu glass"
      data-hit
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerLeave={() => (leaveTimer.current = window.setTimeout(onClose, 900))}
      onPointerEnter={() => window.clearTimeout(leaveTimer.current)}
    >
      {menu.items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={`menu-item${item.danger ? " danger" : ""}`}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          <span>{item.label}</span>
          {item.hint && <span className="menu-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
