import { useEffect, useRef, useState, type RefObject } from "react";
import { dotClass } from "../lib/threadUi";
import { useTicker, type Game } from "../lib/useGame";
import type { ThreadView } from "../lib/useT3";
import { Conversation, type ConversationProps } from "./Conversation";

interface Props extends Omit<ConversationProps, "thread" | "threadCount" | "footer"> {
  threads: ThreadView[];
  selected: ThreadView | null;
  game: Game;
  focused: boolean;
  onSelect: (threadId: string) => void;
  onFocusRequest: () => void;
  /** Shrunk to a notification-sized pill (the – button); click it to expand. */
  minimized: boolean;
  onMinimize: () => void;
  onExpand: () => void;
}

// ---------- position: draggable by the tab bar, remembered between games ----------

const POS_KEY = "t3-overlay:inbox-pos";
type Pos = { x: number; y: number };

function defaultPos(): Pos {
  // Left side, clear of the shop in the middle of the screen.
  return { x: Math.round(window.innerWidth * 0.015), y: Math.round(window.innerHeight * 0.1) };
}

function loadPos(): Pos {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
    if (typeof p?.x === "number" && typeof p?.y === "number") return p;
  } catch {}
  return defaultPos();
}

function clampPos(p: Pos, el: HTMLElement | null): Pos {
  const w = el?.offsetWidth ?? 400;
  return {
    x: Math.round(Math.min(Math.max(0, p.x), window.innerWidth - Math.min(w, 120))),
    y: Math.round(Math.min(Math.max(0, p.y), window.innerHeight - 48)),
  };
}

function useDrag(rootRef: RefObject<HTMLDivElement | null>) {
  const [pos, setPos] = useState(loadPos);
  const [dragging, setDragging] = useState(false);

  const start = (e: React.PointerEvent) => {
    // Drag from the empty parts of the tab bar or the grip, not from buttons.
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const from = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    let latest = pos;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      latest = clampPos({ x: ev.clientX - from.x, y: ev.clientY - from.y }, rootRef.current);
      setPos(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      localStorage.setItem(POS_KEY, JSON.stringify(latest));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const reset = () => {
    const p = defaultPos();
    setPos(p);
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  };

  return { pos: clampPos(pos, rootRef.current), dragging, start, reset };
}

export function Inbox(props: Props) {
  const { threads, selected, game } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedTabRef = useRef<HTMLButtonElement>(null);
  const drag = useDrag(rootRef);
  useTicker(game.dead);

  // Keep the selected tab visible when the strip scrolls.
  useEffect(() => {
    selectedTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected?.threadId]);

  // Mouse wheel over the tabs switches threads (one step per notch).
  const lastWheel = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const now = Date.now();
    if (delta === 0 || now - lastWheel.current < 120) return;
    lastWheel.current = now;
    props.onCycle(delta > 0 ? 1 : -1);
  };

  const remaining = game.respawnAt ? Math.max(0, (game.respawnAt - Date.now()) / 1000) : 0;
  const progress = game.respawnTotal > 0 ? 1 - remaining / game.respawnTotal : 0;

  if (props.minimized) {
    const others = threads.filter((t) => t.unread && t.threadId !== selected?.threadId).length;
    return (
      <div className="inbox-pill glass" data-hit style={{ left: drag.pos.x, top: drag.pos.y }}>
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
    {drag.dragging && <div className="drag-shield" data-hit />}
    <div
      ref={rootRef}
      className={`inbox glass${drag.dragging ? " dragging" : ""}`}
      style={{ left: drag.pos.x, top: drag.pos.y }}
      data-hit
      onMouseDown={() => !props.focused && props.onFocusRequest()}
    >
      <div className="tabs" onPointerDown={drag.start} onDoubleClick={(e) => !(e.target as HTMLElement).closest("button") && drag.reset()}>
        <span className="grip" title="Drag to move · double-click to reset">⠿</span>
        <div className="tab-strip" onWheel={onWheel}>
          {threads.map((t) => (
            <button
              key={t.threadId}
              ref={t.threadId === selected?.threadId ? selectedTabRef : undefined}
              className={`tab${t.threadId === selected?.threadId ? " on" : ""}`}
              onClick={() => props.onSelect(t.threadId)}
              title={`${t.projectTitle} · ${t.title}`}
            >
              <span className={dotClass(t)} />
              <span className="tab-title">{t.title || "Untitled"}</span>
            </button>
          ))}
        </div>
        {game.dead && <span className="timer">respawn {Math.ceil(remaining)}s</span>}
        {game.gameEnded && !game.dead && <span className="timer ended">game over</span>}
        <button className="close minimize" onClick={props.onMinimize} title="Minimize to a notification">
          –
        </button>
        <button className="close" onClick={props.onClose} title="Close (Esc)">
          ×
        </button>
      </div>

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
    </div>
    </>
  );
}
