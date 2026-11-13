import { useEffect, useRef, type RefObject } from "react";
import Markdown from "react-markdown";
import { isWorking } from "../lib/t3";
import { useTicker, type Game } from "../lib/useGame";
import type { ThreadView } from "../lib/useT3";

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
  onSelect: (threadId: string) => void;
  onCycle: (step: number) => void;
  onDraft: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  onFocusRequest: () => void;
}

function dotClass(t: ThreadView) {
  if (isWorking(t.status)) return "dot run";
  if (t.unread) return "dot new";
  if (t.status === "failed" || t.status === "interrupted") return "dot fail";
  return "dot idle";
}

function shortKey(hotkey: string) {
  return hotkey.replace(/Ctrl/g, "⌃").replace(/Shift/g, "⇧").replace(/Alt/g, "⌥").replace(/\+/g, "");
}

export function Inbox(props: Props) {
  const { threads, selected, game } = props;
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastReplyRef = useRef<HTMLDivElement>(null);
  useTicker(game.dead);

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
      props.onSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
      props.onCycle(e.shiftKey ? -1 : 1);
    }
  };

  return (
    <div className="inbox glass" data-hit onMouseDown={() => !props.focused && props.onFocusRequest()}>
      <div className="tabs">
        {threads.map((t) => (
          <button
            key={t.threadId}
            className={`tab${t.threadId === selected?.threadId ? " on" : ""}`}
            onClick={() => props.onSelect(t.threadId)}
            title={`${t.projectTitle} · ${t.title}`}
          >
            <span className={dotClass(t)} />
            <span className="tab-title">{t.title || "Untitled"}</span>
          </button>
        ))}
        <span className="spacer" />
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
        <span className="key">{props.sending ? "sending…" : "↵ send"}</span>
        {props.voiceHotkey && <span className="key">hold {shortKey(props.voiceHotkey)} 🎙</span>}
      </div>
      {props.sendError && <div className="send-error">{props.sendError}</div>}
      {game.dead && (
        <div className="bar">
          <i style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
