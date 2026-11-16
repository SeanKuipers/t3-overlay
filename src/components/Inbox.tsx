import { useRef, useState, type RefObject } from "react";
import type { Thread } from "../lib/t3";
import type { Box } from "../lib/useLayout";
import { dotClass } from "../lib/threadUi";
import { useTicker, type Game } from "../lib/useGame";
import type { ThreadView } from "../lib/useT3";
import { ChatSwitcher } from "./ChatSwitcher";
import { Conversation, type ConversationProps } from "./Conversation";
import { NewChat } from "./NewChat";
import { UpdateControl } from "./UpdateControl";

interface Props extends Omit<ConversationProps, "thread" | "threadCount" | "footer"> {
  threads: ThreadView[];
  /** Every chat, for the switcher. */
  allThreads: Thread[];
  selectedId: string | null;
  selected: ThreadView | null;
  game: Game;
  focused: boolean;
  onSelect: (threadId: string) => void;
  onFocusRequest: () => void;
  /** Shrunk to a notification-sized pill (the – button); click it to expand. */
  minimized: boolean;
  onMinimize: () => void;
  onExpand: () => void;
  /** The "New chat" card is showing instead of a thread. */
  composing: boolean;
  onNewChat: () => void;
  onStartChat: (projectId: string | null, message: string) => Promise<void>;
  onCancelNewChat: () => void;
  /** Where the inbox is and how big, from the current layout (null = default). */
  box: Box | null;
  onBoxChange: (box: Box | null) => void;
  /** The layout button: opens the layouts menu at (x, y). */
  onLayoutMenu: (x: number, y: number) => void;
  /** Right-click on a chat. */
  onThreadMenu: (threadId: string, x: number, y: number) => void;
}

// ---------- position and size: from the current layout; drag the top bar, resize the corner ----------

const MIN_W = 320;
const MIN_H = 180;

function defaultBox(): Box {
  // Left side, clear of the shop in the middle of the screen.
  return { x: Math.round(window.innerWidth * 0.015), y: Math.round(window.innerHeight * 0.1), w: null, h: null };
}

function clampBox(b: Box, el: HTMLElement | null): Box {
  const w = b.w === null ? null : Math.round(Math.min(Math.max(MIN_W, b.w), window.innerWidth));
  const h = b.h === null ? null : Math.round(Math.min(Math.max(MIN_H, b.h), window.innerHeight));
  const shown = w ?? el?.offsetWidth ?? 400;
  return {
    x: Math.round(Math.min(Math.max(0, b.x), window.innerWidth - Math.min(shown, 120))),
    y: Math.round(Math.min(Math.max(0, b.y), window.innerHeight - 48)),
    w,
    h,
  };
}

/** Moving (top bar) and resizing (corner grip). Live while dragging; saved on release. */
function useBox(rootRef: RefObject<HTMLDivElement | null>, saved: Box | null, onChange: (box: Box | null) => void) {
  const [live, setLive] = useState<Box | null>(null);
  const [mode, setMode] = useState<"move" | "resize" | null>(null);
  const box = clampBox(live ?? saved ?? defaultBox(), rootRef.current);

  const track = (e: React.PointerEvent, kind: "move" | "resize", next: (dx: number, dy: number) => Box) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    let latest = box;
    setMode(kind);
    const move = (ev: PointerEvent) => {
      latest = clampBox(next(ev.clientX - start.x, ev.clientY - start.y), rootRef.current);
      setLive(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMode(null);
      onChange(latest);
      setLive(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startMove = (e: React.PointerEvent) => {
    // From the empty parts of the top bar or the grip, not from buttons.
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const from = box;
    track(e, "move", (dx, dy) => ({ ...from, x: from.x + dx, y: from.y + dy }));
  };

  const startResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = rootRef.current;
    const from = { ...box, w: box.w ?? el?.offsetWidth ?? 500, h: box.h ?? el?.offsetHeight ?? 360 };
    track(e, "resize", (dx, dy) => ({ ...from, w: from.w + dx, h: from.h + dy }));
  };

  return { box, mode, startMove, startResize, reset: () => onChange(null) };
}

export function Inbox(props: Props) {
  const { threads, selected, game } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useBox(rootRef, props.box, props.onBoxChange);
  const pos = { left: drag.box.x, top: drag.box.y };
  useTicker(game.dead);

  const remaining = game.respawnAt ? Math.max(0, (game.respawnAt - Date.now()) / 1000) : 0;
  const progress = game.respawnTotal > 0 ? 1 - remaining / game.respawnTotal : 0;

  if (props.minimized) {
    const others = threads.filter((t) => t.unread && t.threadId !== selected?.threadId).length;
    return (
      <div className="inbox-pill glass" data-hit style={pos}>
        <button className="pill-main" onClick={props.onExpand} title="Expand the inbox">
          {selected && <span className={dotClass(selected)} />}
          <span className="pill-title">{selected?.title || "Inbox"}</span>
          {props.draft.trim() && <span className="pill-tag">unsent draft</span>}
          {others > 0 && <span className="pill-tag new">+{others} new</span>}
          {game.dead && <span className="timer">{Math.ceil(remaining)}s</span>}
          <span className="pill-expand" aria-hidden>
            ⤢
          </span>
        </button>
        <button className="close" onClick={props.onClose} title="Close">
          ×
        </button>
      </div>
    );
  }

  return (
    <>
    {/* While dragging, the whole screen catches the mouse so a fast drag can't slip off. */}
    {drag.mode && <div className={`drag-shield ${drag.mode}`} data-hit />}
    <div
      ref={rootRef}
      className={`inbox glass${drag.mode ? " dragging" : ""}${drag.box.h !== null ? " sized" : ""}`}
      style={{
        ...pos,
        ...(drag.box.w !== null ? { width: drag.box.w } : {}),
        ...(drag.box.h !== null ? { height: drag.box.h } : {}),
      }}
      data-hit
      onMouseDown={() => !props.focused && props.onFocusRequest()}
    >
      <div className="tabs" onPointerDown={drag.startMove} onDoubleClick={(e) => !(e.target as HTMLElement).closest("button") && drag.reset()}>
        <span className="grip" title="Drag to move · double-click to reset">⠿</span>
        <ChatSwitcher
          threads={threads}
          all={props.allThreads}
          selectedId={props.selectedId}
          composing={props.composing}
          onSelect={props.onSelect}
          onNewChat={props.onNewChat}
          onThreadMenu={props.onThreadMenu}
          onCycle={props.onCycle}
        />
        <span className="spacer" />
        <button className="close head-new" onClick={props.onNewChat} title="New chat (Ctrl+N)">
          +
        </button>
        <button
          className="close head-layout"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            props.onLayoutMenu(r.left, r.bottom + 4);
          }}
          title="Layouts: swap or save where things sit (Ctrl+1/2/3)"
          aria-label="Layouts"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18M9 12h12" />
          </svg>
        </button>
        {/* Only when there's something to do: a new version is downloading / ready / failed. */}
        {["downloading", "ready", "installing", "error"].includes(props.update.status.phase) && (
          <span className="head-update">
            <UpdateControl version={props.update.version} status={props.update.status} />
          </span>
        )}
        {game.dead && <span className="timer">respawn {Math.ceil(remaining)}s</span>}
        {game.gameEnded && !game.dead && <span className="timer ended">game over</span>}
        <button className="close minimize" onClick={props.onMinimize} title="Minimize to a notification">
          –
        </button>
        <button className="close" onClick={props.onClose} title="Close (Esc)">
          ×
        </button>
      </div>

      {props.composing ? (
        <NewChat
          suggestedProjectId={selected?.projectId ?? null}
          inputRef={props.inputRef}
          onStart={props.onStartChat}
          onCancel={props.onCancelNewChat}
        />
      ) : (
      <Conversation
        {...props}
        thread={selected}
        threadCount={threads.length}
        footer={
          game.dead && (
            <div className="bar">
              <i style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
          )
        }
      />
      )}
      <div className="resize-grip" onPointerDown={drag.startResize} title="Drag to resize · double-click for the default size" onDoubleClick={() => props.onBoxChange(props.box && { ...props.box, w: null, h: null })} />
    </div>
    </>
  );
}
