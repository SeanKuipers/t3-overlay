import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project } from "../lib/t3";

export const SCRATCH = "__scratch__";

/** A stable colour per project, matching the hub's avatars. */
function hue(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function ProjectIcon({ project }: { project: Project | null }) {
  if (!project) {
    return (
      <svg className="project-icon folder" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      </svg>
    );
  }
  return (
    <span className="project-icon" style={{ background: `hsl(${hue(project.id)} 45% 32%)` }}>
      {project.title.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

interface Props {
  projects: Project[] | null;
  value: string;
  onChange: (projectId: string) => void;
  disabled?: boolean;
}

/**
 * T3's new-thread project picker: an inline "Choose a project" trigger that opens a
 * popover with "Search projects…", the project list (arrow keys + Enter) and "No project".
 * Drawn in the overlay itself (via a portal), so it can never end up behind anything.
 */
export function ProjectPicker({ projects, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const current = value === SCRATCH ? null : projects?.find((p) => p.id === value) ?? null;
  const label = value === SCRATCH ? "No project" : current?.title ?? (projects ? "Choose a project" : "Loading…");

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: { id: string; label: string; project: Project | null }[] = (projects ?? [])
      .filter((p) => !q || p.title.toLowerCase().includes(q))
      .map((p) => ({ id: p.id, label: p.title, project: p }));
    if (!q || "no project scratch".includes(q)) list.push({ id: SCRATCH, label: "No project", project: null });
    return list;
  }, [projects, query]);

  // Place the popover under the trigger, kept on screen.
  useLayoutEffect(() => {
    if (!open) return;
    const t = triggerRef.current?.getBoundingClientRect();
    const p = popRef.current?.getBoundingClientRect();
    if (!t) return;
    const width = p?.width ?? 288;
    const height = p?.height ?? 300;
    const below = t.bottom + 6;
    setPos({
      left: Math.max(8, Math.min(t.left, window.innerWidth - width - 8)),
      top: below + height > window.innerHeight - 8 ? Math.max(8, t.top - height - 6) : below,
    });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(Math.max(0, items.findIndex((i) => i.id === value)));
    requestAnimationFrame(() => searchRef.current?.focus());
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    // Only a click elsewhere (or Esc) closes it; focus moving around doesn't.
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(items.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[highlight];
      if (item) choose(item.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="project-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={current?.title}
      >
        <ProjectIcon project={value === SCRATCH ? null : current} />
        <span className="project-trigger-label">{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div ref={popRef} className="project-popover glass" data-hit style={pos} role="listbox" onKeyDown={onKeyDown}>
            <input
              ref={searchRef}
              className="project-search"
              aria-label="Search projects"
              placeholder="Search projects..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
            />
            <div className="project-list">
              {items.length === 0 ? (
                <div className="project-empty">No matching projects.</div>
              ) : (
                items.map((item, i) => (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={item.id === value}
                    className={`project-item${i === highlight ? " hl" : ""}${item.id === value ? " on" : ""}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => choose(item.id)}
                  >
                    <ProjectIcon project={item.project} />
                    <span className="project-item-label">{item.label}</span>
                    {item.id === value && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.querySelector(".overlay-root") ?? document.body,
        )}
    </>
  );
}
