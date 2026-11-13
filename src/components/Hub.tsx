import { useEffect, useMemo, useState } from "react";
import { isWorking } from "../lib/t3";
import { dotClass, previewLine, relativeTimeShort, workingFor } from "../lib/threadUi";
import { useTicker } from "../lib/useGame";
import type { ThreadView } from "../lib/useT3";
import { Conversation, type ConversationProps } from "./Conversation";
import { NewChat } from "./NewChat";
import { UpdateControl } from "./UpdateControl";

// The chat hub: outside games, a roster docked on the left of the screen with the open
// conversation beside it. Modelled on OpenBot's sidebar: two-line rows (name + time or
// "Working", then a preview), an unread dot, search on top, a draggable edge (220-480px,
// remembered) and a collapsed rail.

const WIDTH_KEY = "t3-overlay:hub-width";
const COLLAPSED_KEY = "t3-overlay:hub-collapsed";
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const RAIL_WIDTH = 52;
const EDGE = 12;
const GAP = 10;

function storedWidth() {
  const n = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH ? n : DEFAULT_WIDTH;
}

/** A stable colour per project, for the row avatars. */
function hue(id: string | undefined) {
  let h = 0;
  for (const c of id ?? "") h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function Avatar({ thread }: { thread: ThreadView }) {
  const initial = (thread.projectTitle || thread.title || "?").trim().charAt(0).toUpperCase();
  return (
    <span className="avatar" style={{ background: `hsl(${hue(thread.projectId || thread.title)} 45% 32%)` }}>
      {initial}
      {isWorking(thread.status) && thread.questions.length === 0 && <span className="avatar-ring" />}
      {thread.questions.length > 0 && <span className="avatar-ask">?</span>}
      {thread.unread && <span className="avatar-unread" />}
    </span>
  );
}

interface Props extends Omit<ConversationProps, "thread" | "threadCount" | "footer" | "onClose"> {
  threads: ThreadView[];
  selected: ThreadView | null;
  chatOpen: boolean;
  focused: boolean;
  onOpen: (threadId: string) => void;
  onCloseChat: () => void;
  onFocusRequest: () => void;
  onOpenSettings: () => void;
  composing: boolean;
  onNewChat: () => void;
  onStartChat: (projectId: string | null, message: string) => Promise<void>;
  onCancelNewChat: () => void;
}

export function Hub(props: Props) {
  const { threads, selected, chatOpen } = props;
  const [width, setWidth] = useState(storedWidth);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const [resizing, setResizing] = useState(false);
  const [search, setSearch] = useState("");
  useTicker(true, 5_000); // keeps "5m" and "Working 4m" fresh

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const railWidth = collapsed ? RAIL_WIDTH : width;
  // The ticker's default spot is just right of the hub and its chat pane (see .corner).
  const paneOpen = chatOpen && (!!selected || props.composing);
  const chatWidth = paneOpen ? Math.min(500, window.innerWidth - 400) + GAP : 0;
  useEffect(() => {
    document.documentElement.style.setProperty("--hub-right", `${EDGE + railWidth + GAP + chatWidth}px`);
    return () => {
      document.documentElement.style.removeProperty("--hub-right");
    };
  }, [railWidth, chatWidth]);

  // Search what a row shows: its name, project and preview.
  const term = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      term
        ? threads.filter((t) => `${t.title} ${t.projectTitle} ${previewLine(t, 400)}`.toLowerCase().includes(term))
        : threads,
    [threads, term],
  );

  // Drag the right edge to resize.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const fromX = e.clientX;
    const fromWidth = width;
    let latest = width;
    setResizing(true);
    const move = (ev: PointerEvent) => {
      latest = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, fromWidth + ev.clientX - fromX)));
      setWidth(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResizing(false);
      localStorage.setItem(WIDTH_KEY, String(latest));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const open = (threadId: string) => {
    setCollapsed(false);
    props.onOpen(threadId);
  };

  const focusOnClick = () => !props.focused && props.onFocusRequest();

  return (
    <>
      {resizing && <div className="drag-shield resize" data-hit />}

      {collapsed ? (
        <div className="hub rail glass" data-hit style={{ width: RAIL_WIDTH }}>
          <button className="hub-icon" onClick={() => setCollapsed(false)} title="Expand">
            »
          </button>
          <div className="rail-list">
            {threads.map((t) => (
              <button
                key={t.threadId}
                className={`rail-item${chatOpen && t.threadId === selected?.threadId ? " on" : ""}`}
                onClick={() => open(t.threadId)}
                title={`${t.title} · ${t.projectTitle}`}
              >
                <Avatar thread={t} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="hub glass" data-hit style={{ width }} onMouseDown={focusOnClick}>
          <div className="hub-head">
            <span className={`dot ${props.connected ? "idle" : "fail"}`} />
            <b>T3</b>
            <span className="muted">{threads.length > 0 ? `${threads.length} recent` : ""}</span>
            <span className="spacer" />
            <button className="hub-icon plus" onClick={props.onNewChat} title="New chat">
              +
            </button>
            <button className="hub-icon gear" onClick={props.onOpenSettings} title="Settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button className="hub-icon" onClick={() => setCollapsed(true)} title="Collapse">
              «
            </button>
          </div>
          <input
            className="hub-search"
            placeholder="Search threads"
            aria-label="Search thread names and recent messages"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearch("");
              if (e.key === "Enter" && shown[0]) open(shown[0].threadId);
            }}
          />
          <div className="hub-list">
            {!props.connected ? (
              <button className="hub-empty" onClick={props.onOpenSettings}>
                Not connected to T3 Code. Open Settings.
              </button>
            ) : shown.length === 0 ? (
              <p className="hub-empty muted">{term ? "No matches." : props.error ?? "No recent threads."}</p>
            ) : (
              shown.map((t) => (
                <button
                  key={t.threadId}
                  className={`hub-row${chatOpen && !props.composing && t.threadId === selected?.threadId ? " on" : ""}${t.unread ? " unread" : ""}`}
                  onClick={() => open(t.threadId)}
                  title={`${t.projectTitle} · ${t.title}`}
                >
                  <Avatar thread={t} />
                  <span className="row-main">
                    <span className="row-top">
                      <span className="row-name">{t.title || "Untitled"}</span>
                      {t.questions.length > 0 ? (
                        <span className="row-ask">Question</span>
                      ) : isWorking(t.status) ? (
                        <span className="row-working">Working {workingFor(t)}</span>
                      ) : (
                        <span className="row-time">{relativeTimeShort(t.updatedAt)}</span>
                      )}
                      {t.unread && <span className="row-dot" />}
                    </span>
                    <span className="row-sub">{t.questions[0]?.questions[0]?.question ?? previewLine(t)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="hub-foot">
            <UpdateControl version={props.update.version} status={props.update.status} />
          </div>
          <div className="hub-resize" onPointerDown={startResize} title="Drag to resize" />
        </div>
      )}

      {paneOpen && (
        <div
          className="hub-chat inbox glass"
          data-hit
          style={{ left: EDGE + railWidth + GAP, top: EDGE }}
          onMouseDown={focusOnClick}
        >
          <div className="hub-chat-head">
            {props.composing || !selected ? (
              <span className="hub-chat-title">New chat</span>
            ) : (
              <>
                <span className={dotClass(selected)} />
                <span className="hub-chat-title" title={selected.title}>
                  {selected.title || "Untitled"}
                </span>
              </>
            )}
            <span className="spacer" />
            <button className="close" onClick={props.onCloseChat} title="Close (Esc)">
              ×
            </button>
          </div>
          {props.composing || !selected ? (
            <NewChat
              suggestedProjectId={selected?.projectId ?? null}
              inputRef={props.inputRef}
              onStart={props.onStartChat}
              onCancel={props.onCancelNewChat}
            />
          ) : (
            <Conversation {...props} thread={selected} threadCount={threads.length} onClose={props.onCloseChat} />
          )}
        </div>
      )}
    </>
  );
}
