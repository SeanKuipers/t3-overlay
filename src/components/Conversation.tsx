import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Markdown from "react-markdown";
import type { SendMode, UpdateStatus } from "../lib/native";
import { isWorking } from "../lib/t3";
import { MODE_HELP, shortKey } from "../lib/threadUi";
import type { ThreadView } from "../lib/useT3";
import { UpdateControl } from "./UpdateControl";

export interface ConversationProps {
  thread: ThreadView | null;
  threadCount: number;
  connected: boolean;
  error: string | null;
  draft: string;
  sending: boolean;
  sendError: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  voiceHotkey: string | null;
  navHotkeys: [string, string] | null;
  sendMode: SendMode;
  update: { version: string | null; status: UpdateStatus };
  onDraft: (text: string) => void;
  /** `alternate`: Ctrl+Enter, i.e. the other of queue/steer. */
  onSubmit: (alternate: boolean) => void;
  onClose: () => void;
  onCycle: (step: number) => void;
  /** T3's queued-message actions: send it into the running turn now, or drop it. */
  onSteerQueued: (queuedRunId: string) => void;
  onUnqueue: (queuedRunId: string) => void;
  /** Shown under the reply box, e.g. the respawn bar. */
  footer?: ReactNode;
}

// Icons as T3's composer uses them (lucide): send ↑, steer ↱, queue ≡+.
const ArrowUp = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const lucide = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
export const SteerIcon = () => (
  <svg {...lucide}>
    <polyline points="15 14 20 9 15 4" />
    <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
  </svg>
);
export const QueueIcon = () => (
  <svg {...lucide}>
    <path d="M11 12H3" />
    <path d="M16 6H3" />
    <path d="M16 18H3" />
    <path d="M18 9v6" />
    <path d="M21 12h-6" />
  </svg>
);

/**
 * What Enter does right now, the way T3 decides it: an idle agent just starts; a working one
 * gets your default (queue or steer), and holding Ctrl flips it to the other.
 */
function effectiveMode(running: boolean, base: SendMode, alternate: boolean): "send" | "queue" | "steer" {
  if (!running) return "send";
  const primary = base === "queue" ? "queue" : "steer";
  return alternate ? (primary === "queue" ? "steer" : "queue") : primary;
}

/** A thread's last exchange plus the reply box. Used by the in-game inbox and the hub. */
export function Conversation(props: ConversationProps) {
  const { thread } = props;
  const running = !!thread && isWorking(thread.status);
  const queue = thread?.queue ?? [];
  // Holding Ctrl previews the alternate mode on the send button, like T3.
  const [ctrl, setCtrl] = useState(false);
  useEffect(() => {
    const up = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && setCtrl(false);
    const reset = () => setCtrl(false);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, []);
  const mode = effectiveMode(running, props.sendMode, ctrl);
  const altMode = effectiveMode(running, props.sendMode, !ctrl);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastReplyRef = useRef<HTMLDivElement>(null);
  const conversation = thread?.conversation;
  const replies = conversation?.replies ?? [];

  // Jump to the start of the newest reply when switching threads or when it changes.
  const replyKey = conversation?.replyKey;
  useEffect(() => {
    const body = bodyRef.current;
    const last = lastReplyRef.current;
    if (body && last) body.scrollTop = Math.max(0, last.offsetTop - body.offsetTop - 8);
    else if (body) body.scrollTop = body.scrollHeight;
  }, [thread?.threadId, replyKey]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Control" || e.key === "Meta") setCtrl(true);
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
      <div className="body" ref={bodyRef}>
        {!props.connected ? (
          <p className="muted">Not connected to T3 Code. Open Settings from the tray icon.</p>
        ) : props.threadCount === 0 ? (
          <p className="muted">{props.error ?? "No recent threads."}</p>
        ) : !conversation ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="project">{thread?.projectTitle}</div>
            {conversation.prompt && <div className="prompt">You: {conversation.prompt.text}</div>}
            {replies.length === 0 && !isWorking(thread!.status) && <p className="muted">No reply yet.</p>}
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
            {isWorking(thread!.status) && (
              <div className="working">
                <span className="spinner" /> Working…
              </div>
            )}
          </>
        )}
      </div>

      {queue.length > 0 && (
        <div className="queued" aria-label="Queued messages">
          {queue.map((q) => (
            <div key={q.queuedRunId} className="queued-row">
              <span className="queued-icon" title="Queued: runs after the current turn">
                <QueueIcon />
              </span>
              <span className="queued-text" title={q.text}>
                {q.text}
              </span>
              <button className="queued-btn" onClick={() => props.onSteerQueued(q.queuedRunId)} title="Send as a steer instead">
                <SteerIcon /> Steer
              </button>
              <button className="queued-x" onClick={() => props.onUnqueue(q.queuedRunId)} title="Remove queued message" aria-label="Remove queued message">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="composer">
        <textarea
          ref={props.inputRef}
          rows={1}
          value={props.draft}
          placeholder={thread ? (running ? `${mode === "queue" ? "Queue" : "Steer"} a message for ${thread.title}…` : `Reply to ${thread.title}…`) : "Reply…"}
          disabled={!thread || props.sending}
          onChange={(e) => props.onDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => !e.ctrlKey && !e.metaKey && setCtrl(false)}
        />
        <button
          className={`send-btn ${mode}`}
          disabled={!thread || props.sending || !props.draft.trim()}
          onClick={(e) => props.onSubmit(e.ctrlKey || e.metaKey)}
          title={running ? `Click to ${mode}, Ctrl-click to ${altMode}` : "Send"}
          aria-label={mode === "queue" ? "Queue message" : mode === "steer" ? "Steer message" : "Send message"}
        >
          {props.sending ? <span className="spinner" /> : mode === "queue" ? <QueueIcon /> : mode === "steer" ? <SteerIcon /> : <ArrowUp />}
        </button>
      </div>
      <div className="hints">
        {props.sending ? (
          <span>sending…</span>
        ) : running ? (
          <>
            <span className="mode-hint on" title={MODE_HELP[mode as SendMode]}>
              <span className="key">↵</span> {mode}
            </span>
            <span className="mode-hint" title={MODE_HELP[altMode as SendMode]}>
              <span className="key">⌃↵</span> {altMode}
            </span>
          </>
        ) : (
          <span>
            <span className="key">↵</span> send
          </span>
        )}
        {props.navHotkeys && props.threadCount > 1 && (
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
      {props.footer}
    </>
  );
}
