import { useEffect, useRef, useState, type RefObject } from "react";
import Markdown from "react-markdown";
import { isWorking } from "../lib/t3";
import { useTicker, type Game } from "../lib/useGame";
import type { ThreadView } from "../lib/useT3";
import type { SendMode, UpdateStatus } from "../lib/native";
import { UpdateControl } from "./UpdateControl";

interface Props {
  threads: ThreadView[];
  selected: ThreadView | null;
  connected: boolean;
  error: string | null;
  game: Game;
  draft: string;
  sending: boolean;
  sendError: string | null;
  focused: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  voiceHotkey: string | null;
  navHotkeys: [string, string] | null;
  update: { version: string | null; status: UpdateStatus };
  onSelect: (threadId: string) => void;
  onCycle: (step: number) => void;
  onDraft: (text: string) => void;
  /** `alternate`: Ctrl+Enter, i.e. the other of queue/steer. */
  onSubmit: (alternate: boolean) => void;
  sendMode: SendMode;
  onClose: () => void;
  onFocusRequest: () => void;
}

function dotClass(t: ThreadView) {
  if (isWorking(t.status)) return "dot run";
  if (t.unread) return "dot new";
  if (t.status === "failed" || t.status === "interrupted") return "dot fail";
  return "dot idle";
}

const MODE_HELP: Record<SendMode, string> = {
  queue: "Runs as the next turn, after the agent finishes what it's doing",
  steer: "Added to the turn the agent is working on right now",
  auto: "Starts an idle thread, steers a running one",
};

function shortKey(hotkey: string) {
  return hotkey.replace(/Ctrl/g, "⌃").replace(/Shift/g, "⇧").replace(/Alt/g, "⌥").replace(/\+/g, "");
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastReplyRef = useRef<HTMLDivElement>(null);
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

  const replyKey = selected?.conversation?.replyKey;
  // Jump to the start of the newest reply when switching threads or when it changes.
  useEffect(() => {
    const body = bodyRef.current;
    const last = lastReplyRef.current;
    if (body && last) body.scrollTop = Math.max(0, last.offsetTop - body.offsetTop - 8);
    else if (body) body.scrollTop = body.scrollHeight;
  }, [selected?.threadId, replyKey]);

  const remaining = game.respawnAt ? Math.max(0, (game.respawnAt - Date.now()) / 1000) : 0;
  const progress = game.respawnTotal > 0 ? 1 - remaining / game.respawnTotal : 0;
  const conversation = selected?.conversation;
  const replies = conversation?.replies ?? [];

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      props.onSubmit(e.ctrlKey || e.metaKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
      props.onCycle(e.shiftKey ? -1 : 1);
    }
  };

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
        <button className="close" onClick={props.onClose} title="Close (Esc)">
          ×
        </button>
      </div>

      <div className="body" ref={bodyRef}>
        {!props.connected ? (
          <p className="muted">Not connected to T3 Code. Open Settings from the tray icon.</p>
        ) : threads.length === 0 ? (
          <p className="muted">{props.error ?? "No recent threads."}</p>
        ) : !conversation ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="project">{selected?.projectTitle}</div>
            {conversation.prompt && <div className="prompt">You: {conversation.prompt.text}</div>}
            {replies.length === 0 && !isWorking(selected!.status) && <p className="muted">No reply yet.</p>}
            {replies.map((item, index) => (
              <div
                key={item.itemId}
                ref={index === replies.length - 1 ? lastReplyRef : undefined}
                className={`reply${index === replies.length - 1 ? " final" : ""}`}
              >
                <Markdown>{item.text ?? ""}</Markdown>
                {item.textTruncated && <div className="muted small">… (truncated, open T3 for the rest)</div>}
              </div>
            ))}
            {isWorking(selected!.status) && (
              <div className="working">
                <span className="spinner" /> Working…
              </div>
            )}
          </>
        )}
      </div>

      <div className="composer">
        <textarea
          ref={props.inputRef}
          rows={1}
          value={props.draft}
          placeholder={selected ? `Reply to ${selected.title}…` : "Reply…"}
          disabled={!selected || props.sending}
          onChange={(e) => props.onDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="hints">
        {props.sending ? (
          <span>sending…</span>
        ) : (
          <>
            <span title={MODE_HELP[props.sendMode]}>
              <span className="key">↵</span> {props.sendMode}
            </span>
            <span title={MODE_HELP[props.sendMode === "steer" ? "queue" : "steer"]}>
              <span className="key">⌃↵</span> {props.sendMode === "steer" ? "queue" : "steer"}
            </span>
          </>
        )}
        {props.navHotkeys && threads.length > 1 && (
          <span title="Scrolling over the tabs works too">
            <span className="key">{shortKey(props.navHotkeys[0])}</span>
            <span className="key">{shortKey(props.navHotkeys[1])}</span> threads
          </span>
        )}
        {props.voiceHotkey && (
          <span>
            hold <span className="key">{shortKey(props.voiceHotkey)}</span> talk
          </span>
        )}
        <UpdateControl version={props.update.version} status={props.update.status} />
      </div>
      {props.sendError && <div className="send-error">{props.sendError}</div>}
      {game.dead && (
        <div className="bar">
          <i style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </div>
      )}
    </div>
    </>
  );
}
