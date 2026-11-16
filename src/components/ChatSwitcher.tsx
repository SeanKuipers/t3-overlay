import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isWorking, type Thread } from "../lib/t3";
import { dotClass, relativeTimeShort, workingFor } from "../lib/threadUi";
import type { ThreadView } from "../lib/useT3";

const NEW = "__new__";

interface Row {
  id: string;
  title: string;
  project: string;
  dot: string;
  status: React.ReactNode;
  /** Active chats have a right-click menu. */
  active: boolean;
}

interface Section {
  label: string;
  rows: Row[];
}

function activeRow(t: ThreadView): Row {
  const status =
    t.questions.length > 0 ? (
      <span className="row-ask">Question</span>
    ) : isWorking(t.status) ? (
      <span className="row-working">Working {workingFor(t)}</span>
    ) : t.unread ? (
      <span className="row-new">New reply</span>
    ) : (
      <span className="row-time">{relativeTimeShort(t.updatedAt)}</span>
    );
  return { id: t.threadId, title: t.title || "Untitled", project: t.projectTitle, dot: dotClass(t), status, active: true };
}

function olderRow(t: Thread): Row {
  const working = isWorking(t.status);
  const failed = t.status === "failed" || t.status === "interrupted";
  return {
    id: t.threadId,
    title: t.title || "Untitled",
    project: t.projectTitle,
    dot: working ? "dot run" : failed ? "dot fail" : "dot idle",
    status: working ? <span className="row-working">Working</span> : <span className="row-time">{relativeTimeShort(t.updatedAt)}</span>,
    active: false,
  };
}

interface Props {
  /** Active chats (read and polled). */
  threads: ThreadView[];
  /** Every chat, newest first. */
  all: Thread[];
  selectedId: string | null;
  composing: boolean;
  onSelect: (threadId: string) => void;
  onNewChat: () => void;
  onThreadMenu: (threadId: string, x: number, y: number) => void;
  onCycle: (step: number) => void;
  /** Bump to open the list from outside (e.g. the dock's "All chats"). */
  openSignal?: number;
}

/**
 * The chat switcher: the current chat's name with a ▾; click it (or Ctrl+K) for every chat,
 * searchable, grouped by what needs you. Mouse wheel over it steps through the active ones.
 */
export function ChatSwitcher(props: Props) {
  const { threads, all, selectedId } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedView = threads.find((t) => t.threadId === selectedId) ?? null;
  const selectedAny = selectedView ?? all.find((t) => t.threadId === selectedId) ?? null;
  // Other chats that want you: shown as a badge on the trigger.
  const waiting = threads.filter((t) => t.threadId !== selectedId && (t.unread || t.questions.length > 0)).length;

  const sections = useMemo<Section[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (t: Thread) => !q || t.title.toLowerCase().includes(q) || t.projectTitle.toLowerCase().includes(q);
    const active = new Set(threads.map((t) => t.threadId));
    const views = threads.filter(match);
    const needs = views.filter((t) => t.questions.length > 0 || t.unread);
    const working = views.filter((t) => !needs.includes(t) && isWorking(t.status));
    const recent = views.filter((t) => !needs.includes(t) && !working.includes(t));
    const older = all.filter((t) => !active.has(t.threadId) && match(t)).slice(0, q ? 80 : 40);
    const out: Section[] = [];
    if (!q || "new chat".includes(q)) {
      out.push({
        label: "",
        rows: [{ id: NEW, title: "New chat", project: "", dot: "", status: <span className="row-time">Ctrl+N</span>, active: false }],
      });
    }
    if (needs.length) out.push({ label: "Needs you", rows: needs.map(activeRow) });
    if (working.length) out.push({ label: "Working", rows: working.map(activeRow) });
    if (recent.length) out.push({ label: "Recent", rows: recent.map(activeRow) });
    if (older.length) out.push({ label: "Earlier", rows: older.map(olderRow) });
    return out;
  }, [threads, all, query]);
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  // Opening: clear the search, highlight the current chat, focus the search box.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => searchRef.current?.focus());
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const index = rows.findIndex((r) => r.id === selectedId);
    setHighlight(query ? 0 : Math.max(0, index));
    // Only when opening or searching; not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);

  useEffect(() => {
    if (props.openSignal) setOpen(true);
  }, [props.openSignal]);

  // Ctrl+K: open / close the list. Ctrl+N: new chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (key === "n") {
        e.preventDefault();
        setOpen(false);
        props.onNewChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onNewChat]);

  // Below the trigger, kept on screen; follows it if the panel moves (e.g. the dock's chat
  // pane re-centring as it loads).
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      const p = popRef.current?.getBoundingClientRect();
      if (t) {
        const width = p?.width ?? 360;
        const height = p?.height ?? 420;
        const below = t.bottom + 6;
        const left = Math.round(Math.max(8, Math.min(t.left, window.innerWidth - width - 8)));
        const top = Math.round(below + height > window.innerHeight - 8 ? Math.max(8, t.top - height - 6) : below);
        setPos((old) => (old.left === left && old.top === top ? old : { left, top }));
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Keep the highlighted row in view.
  useEffect(() => {
    listRef.current?.querySelector(".switch-row.hl")?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const choose = (id: string) => {
    setOpen(false);
    if (id === NEW) props.onNewChat();
    else props.onSelect(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      setHighlight((h) => Math.min(rows.length - 1, h + 1));
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[highlight];
      if (row) choose(row.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  // Wheel over the trigger: previous / next active chat (one step per notch).
  const lastWheel = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const now = Date.now();
    if (delta === 0 || now - lastWheel.current < 120) return;
    lastWheel.current = now;
    props.onCycle(delta > 0 ? 1 : -1);
  };

  let index = -1;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`switcher-trigger${open ? " open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        onWheel={onWheel}
        onContextMenu={(e) => {
          e.preventDefault();
          if (selectedView && !props.composing) props.onThreadMenu(selectedView.threadId, e.clientX, e.clientY);
        }}
        title={`${selectedAny?.projectTitle ? `${selectedAny.projectTitle} · ` : ""}All chats (Ctrl+K) · scroll to switch`}
      >
        {props.composing ? (
          <>
            <span className="switcher-plus">+</span>
            <span className="switcher-title">New chat</span>
          </>
        ) : (
          <>
            {selectedView ? <span className={dotClass(selectedView)} /> : <span className="dot idle" />}
            <span className="switcher-title">{selectedAny?.title || (selectedId ? "Loading…" : "Chats")}</span>
          </>
        )}
        {waiting > 0 && <span className="switcher-badge" title={`${waiting} other chat${waiting > 1 ? "s" : ""} waiting for you`}>{waiting}</span>}
        <svg className="switcher-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div ref={popRef} className="switcher-popover glass" data-hit style={pos} role="listbox" onKeyDown={onKeyDown}>
            <input
              ref={searchRef}
              className="project-search"
              aria-label="Search chats"
              placeholder="Search chats and projects..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="switcher-list" ref={listRef}>
              {rows.length === 0 && <div className="project-empty">No matching chats.</div>}
              {sections.map((section, s) => (
                <div key={section.label || s} className="switch-section">
                  {section.label && <div className="switch-label">{section.label}</div>}
                  {section.rows.map((row) => {
                    const i = ++index;
                    const isNew = row.id === NEW;
                    return (
                      <button
                        key={row.id}
                        role="option"
                        aria-selected={row.id === selectedId}
                        className={`switch-row${i === highlight ? " hl" : ""}${!props.composing && row.id === selectedId ? " on" : ""}${isNew ? " new" : ""}`}
                        onMouseMove={() => i !== highlight && setHighlight(i)}
                        onClick={() => choose(row.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (row.active) {
                            setOpen(false);
                            props.onThreadMenu(row.id, e.clientX, e.clientY);
                          }
                        }}
                      >
                        {isNew ? <span className="switcher-plus">+</span> : <span className={row.dot} />}
                        <span className="switch-text">
                          <b>{row.title}</b>
                          {row.project && <small>{row.project}</small>}
                        </span>
                        <span className="switch-status">{row.status}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>,
          document.querySelector(".overlay-root") ?? document.body,
        )}
    </>
  );
}
