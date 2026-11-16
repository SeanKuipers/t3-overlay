import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Starts a new group: a divider, with this title if non-empty. */
  section?: string;
  /** Keep the menu open after clicking (e.g. to see a change happen). */
  keepOpen?: boolean;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
  /** Shown at the top, small and muted. */
  title?: string;
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
      {menu.title && <div className="menu-head">{menu.title}</div>}
      {menu.items.map((item, i) => (
        <Fragment key={`${i}:${item.label}`}>
          {item.section !== undefined && (
            <>
              {i > 0 && <div className="menu-sep" />}
              {item.section && <div className="menu-title">{item.section}</div>}
            </>
          )}
          <button
            role="menuitem"
            className={`menu-item${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              if (!item.keepOpen) onClose();
              item.onClick();
            }}
          >
            <span>{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
